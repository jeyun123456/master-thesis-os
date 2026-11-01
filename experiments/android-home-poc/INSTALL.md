# Chocomint Lab Android Companion v1.0.0 — 빌드·설치

> 상태: 소스 구현 단계. 아직 컴파일·실기기 검증을 하지 않았고, 서명된 APK는 생성되지 않았다.

## 빌드 설정 (저장소에 커밋하지 않음)

`~/.gradle/gradle.properties` 또는 `-P` 인자로 전달한다.

```properties
chocomint.baseUrl=https://<운영 Next.js HTTPS Origin>
chocomint.googleWebClientId=<P0가 검증하는 Google OAuth Web client id>
# release 서명
chocomint.keystore=C:/secure/chocomint-release.jks
chocomint.keystorePassword=...
chocomint.keyAlias=...
chocomint.keyPassword=...
```

`assembleRelease`는 위 값이 없으면 의도적으로 실패한다(서명 없는 APK·목업 APK 방지).

```powershell
.\bootstrap-wrapper.ps1      # gradle-wrapper.jar가 없을 때 1회
.\gradlew.bat assembleDebug  # 동작 확인용
.\gradlew.bat assembleRelease
```

산출물 `app/build/outputs/apk/release/app-release.apk`를 `Chocomint-Lab-Galaxy-v1.0.0.apk`로 복사하고
`Get-FileHash .\Chocomint-Lab-Galaxy-v1.0.0.apk -Algorithm SHA256` 결과를 `.sha256`에 저장한다.

## Galaxy 설치

1. APK를 Galaxy로 옮겨 연다. 필요하면 해당 파일 앱의 "알 수 없는 앱 설치"만 허용한다.
2. **Chocomint Lab** 실행 → Google 로그인(허용 계정).
3. 홈 화면 길게 누르기 → 위젯 → Chocomint Lab → 오늘의 일정 / 오늘의 할 일 / 빠른 실행 추가.
4. 위젯에 동기화 시각과 실제 데이터가 보이는지 확인. 안 보이면 앱을 열어 새로고침, 로그인 상태·네트워크 확인.

## 서버 전제

`/api/mobile/**`(widget, tasks/[id], auth/google, auth/logout)가 배포된 HTTPS Next.js와 P0, Calendar 서버 설정이 필요하다.
