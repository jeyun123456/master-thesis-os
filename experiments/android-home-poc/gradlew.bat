@echo off
setlocal
set "ROOT=%~dp0"
set "WRAPPER_JAR=%ROOT%gradle\wrapper\gradle-wrapper.jar"

if exist "%WRAPPER_JAR%" (
  java -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
  exit /b %ERRORLEVEL%
)

where gradle >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  gradle %*
  exit /b %ERRORLEVEL%
)

echo Gradle wrapper JAR is not committed in this PoC.
echo Run bootstrap-wrapper.sh / bootstrap-wrapper.ps1, or install Gradle 8.13 and run: gradle wrapper --gradle-version 8.13
exit /b 1
