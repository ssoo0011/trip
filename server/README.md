# PostgreSQL 저장 서버

`server/config.properties`의 PostgreSQL 설정으로 `yth.trip_app_state` 테이블을 자동 생성한 뒤 API를 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\server\run.ps1
```

브라우저 앱은 `http://127.0.0.1:8787/api/state`를 우선 사용하고, API가 꺼져 있으면 기존 IndexedDB를 fallback으로 사용합니다.
