package com.tripplanner.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.Properties;
import java.util.concurrent.Executors;

public final class TravelDbServer {
    private static final String STATE_KEY = "current";
    private static final String CREATE_SCHEMA = "CREATE SCHEMA IF NOT EXISTS yth";
    private static final String CREATE_TABLE = "CREATE TABLE IF NOT EXISTS yth.trip_app_state ("
            + "state_key VARCHAR(64) PRIMARY KEY,"
            + "state_json JSONB NOT NULL,"
            + "updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
            + ")";
    private static final String DEFAULT_URL = "jdbc:log4jdbc:postgresql://localhost:5432/travel?currentSchema=yth&charSet=UTF-8";

    private final String jdbcUrl;
    private final String username;
    private final String password;

    private TravelDbServer(Properties properties) {
        this.jdbcUrl = normalizeJdbcUrl(properties.getProperty("db.url", DEFAULT_URL));
        this.username = properties.getProperty("db.username", "postgres");
        this.password = properties.getProperty("db.password", "1234");
    }

    public static void main(String[] args) throws Exception {
        Properties properties = loadProperties();
        TravelDbServer application = new TravelDbServer(properties);
        application.initializeSchema();

        String host = properties.getProperty("server.host", "127.0.0.1");
        int port = Integer.parseInt(properties.getProperty("server.port", "8787"));
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/api/health", application::handleHealth);
        server.createContext("/api/state", application::handleState);
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.printf("Travel DB API listening on http://%s:%d%n", host, port);
    }

    private static Properties loadProperties() throws IOException {
        Properties properties = new Properties();
        Path path = Path.of(System.getProperty("travel.db.config", "server/config.properties"));
        if (Files.exists(path)) {
            try (InputStream input = Files.newInputStream(path)) {
                properties.load(input);
            }
        }
        return properties;
    }

    private static String normalizeJdbcUrl(String url) {
        return url.replace("jdbc:log4jdbc:postgresql:", "jdbc:postgresql:");
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private void initializeSchema() throws SQLException {
        try (Connection connection = openConnection(); Statement statement = connection.createStatement()) {
            statement.execute(CREATE_SCHEMA);
            statement.execute(CREATE_TABLE);
        }
    }

    private String loadState() throws SQLException {
        String sql = "SELECT state_json::text FROM yth.trip_app_state WHERE state_key = ?";
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, STATE_KEY);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? result.getString(1) : null;
            }
        }
    }

    private void saveState(String json) throws SQLException {
        String sql = "INSERT INTO yth.trip_app_state (state_key, state_json, updated_at) VALUES (?, ?::jsonb, CURRENT_TIMESTAMP) "
                + "ON CONFLICT (state_key) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = CURRENT_TIMESTAMP";
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, STATE_KEY);
            statement.setString(2, json);
            statement.executeUpdate();
        }
    }

    private void handleHealth(HttpExchange exchange) throws IOException {
        if (!prepare(exchange, "GET,OPTIONS")) return;
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            send(exchange, 204, "");
            return;
        }
        try (Connection connection = openConnection()) {
            sendJson(exchange, 200, "{\"ok\":true,\"database\":\"connected\",\"time\":\"" + Instant.now() + "\"}");
        } catch (SQLException error) {
            sendJson(exchange, 503, "{\"ok\":false,\"database\":\"unavailable\"}");
        }
    }

    private void handleState(HttpExchange exchange) throws IOException {
        if (!prepare(exchange, "GET,PUT,OPTIONS")) return;
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            send(exchange, 204, "");
            return;
        }
        try {
            if ("GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                String state = loadState();
                if (state == null) {
                    sendJson(exchange, 404, "{\"message\":\"state not found\"}");
                } else {
                    sendJson(exchange, 200, state);
                }
                return;
            }
            if ("PUT".equalsIgnoreCase(exchange.getRequestMethod())) {
                String body = readBody(exchange);
                if (body.isBlank() || !body.trim().startsWith("{")) {
                    sendJson(exchange, 400, "{\"message\":\"JSON object required\"}");
                    return;
                }
                saveState(body);
                sendJson(exchange, 200, "{\"ok\":true}");
                return;
            }
            sendJson(exchange, 405, "{\"message\":\"method not allowed\"}");
        } catch (SQLException error) {
            sendJson(exchange, 503, "{\"message\":\"database unavailable\"}");
        } catch (IllegalArgumentException error) {
            sendJson(exchange, 413, "{\"message\":\"request too large\"}");
        }
    }

    private static boolean prepare(HttpExchange exchange, String methods) throws IOException {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", methods);
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        return true;
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        if (exchange.getRequestHeaders().getFirst("Content-Length") != null
                && Long.parseLong(exchange.getRequestHeaders().getFirst("Content-Length")) > 2_000_000) {
            throw new IllegalArgumentException("body too large");
        }
        try (InputStream input = exchange.getRequestBody()) {
            byte[] body = input.readAllBytes();
            if (body.length > 2_000_000) throw new IllegalArgumentException("body too large");
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    private static void sendJson(HttpExchange exchange, int status, String body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        send(exchange, status, body);
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
