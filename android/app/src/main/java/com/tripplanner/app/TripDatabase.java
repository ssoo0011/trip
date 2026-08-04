package com.tripplanner.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.webkit.JavascriptInterface;

public class TripDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "trip_planner.db";
    private static final int DATABASE_VERSION = 1;
    private static final String TABLE_STATE = "app_state";
    private static final String KEY_CURRENT = "current";

    public TripDatabase(Context context) {
        super(context.getApplicationContext(), DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS " + TABLE_STATE + " (state_key TEXT PRIMARY KEY NOT NULL, state_value TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
    }

    @JavascriptInterface
    public synchronized String loadState() {
        try (Cursor cursor = getReadableDatabase().query(TABLE_STATE, new String[]{"state_value"}, "state_key = ?", new String[]{KEY_CURRENT}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    @JavascriptInterface
    public synchronized boolean saveState(String json) {
        if (json == null) return false;
        ContentValues values = new ContentValues();
        values.put("state_key", KEY_CURRENT);
        values.put("state_value", json);
        return getWritableDatabase().insertWithOnConflict(TABLE_STATE, null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1;
    }
}
