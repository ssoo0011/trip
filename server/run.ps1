$ErrorActionPreference = 'Stop'

$serverRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $serverRoot
$driver = Join-Path $serverRoot 'lib\postgresql-42.7.3.jar'
$output = Join-Path $serverRoot 'out'

if (-not (Test-Path -LiteralPath $driver)) {
    throw "PostgreSQL JDBC driver not found: $driver"
}

New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = Get-ChildItem -LiteralPath (Join-Path $serverRoot 'src\main\java') -Recurse -Filter '*.java' -File
javac -encoding UTF-8 -cp $driver -d $output $sources.FullName
Push-Location $projectRoot
try {
    java -cp "$output;$driver" com.tripplanner.server.TravelDbServer
} finally {
    Pop-Location
}
