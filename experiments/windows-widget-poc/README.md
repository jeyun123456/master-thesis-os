# Master Thesis OS Windows Widget PoC

Windows 11의 공식 Widgets Board에 `Master Thesis OS`라는 서드파티 위젯을 등록하고, 정적 Adaptive Card를 표시할 수 있는지 검증하는 독립 PoC다. 기존 Next.js 앱, Android PoC, wallpaper PoC와 의존성이나 코드를 공유하지 않는다. 표시 데이터는 모두 mock이며 네트워크/API/인증 코드는 없다.

## 조사 결론

2026-09-20 기준 Microsoft의 현재 공식 경로는 다음과 같다.

- Windows App SDK는 C# `IWidgetProvider` 구현을 공식 지원한다. 공급자는 out-of-process COM server이며, 공식 C# walkthrough는 .NET 8과 `Microsoft.WindowsAppSDK` 2.3.1 이상을 요구한다.
- Win32 widget provider는 현재 packaged app만 지원한다. 이 PoC는 공식 C# 샘플과 같은 single-project MSIX 구성을 사용한다.
- 패키지는 `windows.comServer`에 COM class를, `windows.appExtension`에 `com.microsoft.windows.widgets` provider를 등록한다. 공식 문서는 `CreateInstance` 활성화를 권장한다.
- 카드 UI와 데이터는 각각 Adaptive Card template JSON과 data JSON으로 분리해 `WidgetUpdateRequestOptions.Template`/`Data`로 전달한다.
- 위젯 picker에 나타나려면 manifest의 provider/definition/capability/theme resource 등록과 아이콘·300×304 medium preview 이미지가 필요하다.
- 공식 최신 stable sample의 `Samples/Widgets/cs-console-packaged` 구조와 Windows App SDK 2.4.0 사용을 기준으로 구현했다. 실험/preview NuGet 버전은 사용하지 않았다.

공식 근거:

- [Implement a widget provider in a C# Windows App](https://learn.microsoft.com/windows/apps/develop/widgets/implement-widget-provider-cs)
- [Widget provider package manifest XML format](https://learn.microsoft.com/windows/apps/develop/widgets/widget-provider-manifest)
- [Create a widget template with the Adaptive Cards Designer](https://learn.microsoft.com/windows/apps/develop/widgets/widgets-create-a-template)
- [Integrate with the widget picker](https://learn.microsoft.com/windows/apps/design/widgets/widgets-picker-integration)
- [WindowsAppSDK-Samples / Widgets](https://github.com/microsoft/WindowsAppSDK-Samples/tree/main/Samples/Widgets)

## 구현 구조

```text
windows-widget-poc/
├─ Assets/                         # package/picker 이미지와 재생성 스크립트
├─ Package/                        # 인증서, build/install/uninstall/validation 스크립트
├─ WidgetProvider/
│  ├─ Templates/MediumWidget.json  # Adaptive Card visual template
│  ├─ WidgetData.cs                # static data JSON
│  ├─ WidgetTemplate.cs            # packaged template loader
│  ├─ WidgetProvider.cs            # widget lifecycle/update 구현
│  ├─ Program.cs                   # out-of-process COM registration
│  ├─ Package.appxmanifest         # COM + widget provider 등록
│  └─ MasterThesisOs.WidgetProvider.csproj
├─ MasterThesisOs.WindowsWidget.sln
└─ README.md
```

## 요구 환경

- Windows 11 build 22000 이상. 최신 Widgets Board 사용을 위해 Windows와 `Windows Web Experience Pack`을 최신 상태로 유지한다.
- Windows 개발자 모드: **설정 → 시스템 → 개발자용 → 개발자 모드**.
- Visual Studio 2022 최신 버전.
- Visual Studio Installer의 **WinUI application development** workload. 설치 세부 구성에서 Windows 11 SDK(10.0.26100 이상 권장), .NET desktop development tools, MSIX Packaging Tools가 포함되었는지 확인한다.
- .NET 8 SDK.
- 이 프로젝트가 고정한 stable NuGet: `Microsoft.WindowsAppSDK` 2.4.0.

이 PC에는 .NET 8 SDK만 있고 Visual Studio/독립 Windows SDK는 감지되지 않았다. NuGet MSIX build tools로 컴파일과 MSIX 생성은 성공했지만, 완전한 Visual Studio 환경에서는 디버깅·배포 UX와 symbols package도 사용할 수 있다.

## 빌드와 검증

PowerShell에서 이 폴더로 이동한 뒤 실행한다.

```powershell
dotnet restore .\MasterThesisOs.WindowsWidget.sln
dotnet build .\MasterThesisOs.WindowsWidget.sln -c Debug
.\Package\Validate-Poc.ps1
```

서명된 x64 MSIX를 만들려면:

```powershell
.\Package\Build-Package.ps1
```

처음 실행하면 `Package/Certificates/`에 로컬 개발용 `.pfx`와 `.cer`를 만든다. 인증서와 build 산출물은 `.gitignore` 대상이다. 결과 MSIX는 다음 아래에 생성된다.

```text
WidgetProvider/AppPackages/MasterThesisOs.WidgetProvider_1.0.0.0_x64_Test/
```

Windows SDK의 `mspdbcmf.exe`가 없으면 symbols package 생성을 생략한다는 경고가 나올 수 있다. `.msix` 생성과 실행 코드 컴파일에는 영향을 주지 않지만, Visual Studio workload를 설치하면 해소된다.

## 처음 설치하기

이 개발 인증서는 self-signed이므로 먼저 현재 사용자에게 신뢰시켜야 한다.

1. 일반 PowerShell에서 아래를 실행한다. UAC 확인창이 나타나면 승인한다. 스크립트가 관리자 PowerShell로 자동 재실행되어 개발 인증서를 MSIX가 사용하는 `LocalMachine\TrustedPeople`에 넣는다.

```powershell
.\Package\Trust-DevCertificate.ps1
```

3. 관리자 창을 닫고 일반 PowerShell에서 다음을 실행한다.

```powershell
.\Package\Install-Package.ps1
```

또는 인증서를 신뢰시킨 뒤 생성된 `.msix`를 더블 클릭해 App Installer에서 설치할 수 있다. `CurrentUser` 인증서 저장소만 사용하면 AppX 배포가 `0x800B0109`로 거부될 수 있으므로 위의 machine-wide `TrustedPeople` 단계를 따른다. 인증서가 아직 신뢰되지 않았다면 설치 스크립트는 안내 오류를 내고 중단한다.

## Widgets Board에서 표시 확인

1. `Win + W`를 눌러 Widgets Board를 연다.
2. 우측 상단의 **+ / 위젯 추가**를 누른다.
3. 목록에서 **Master Thesis OS**를 찾는다.
4. `+`를 눌러 고정한다.
5. medium 카드에 두 작업, `14:30 연구 미팅`, 논문 진행 `72%`, **대시보드 열기 →**가 표시되는지 확인한다.
6. **대시보드 열기 →**를 눌러 기본 브라우저에서 `https://master-thesis-os.vercel.app`이 열리는지 확인한다.
7. 카드 메뉴에서 위젯을 제거하고 2–4를 반복해 재추가 후에도 같은 카드가 표시되는지 확인한다.

### 수동 검증 결과

2026-09-20, Windows 11 Widgets Board에서 다음을 확인했다.

- 위젯 추가 목록에 `Master Thesis OS`가 나타남
- medium 카드가 실제 보드에 고정됨
- 작업 2개, `14:30 연구 미팅`, `72%` 진행률이 렌더링됨
- `대시보드 열기 →` 버튼이 카드에 표시됨

따라서 이 PoC의 1차 목표인 **공식 Windows 11 Widgets Board에 서드파티 Master Thesis OS 위젯을 등록하고 정적 카드를 렌더링하는 것**은 달성되었다. 제거 후 재추가와 링크의 실제 브라우저 이동은 별도로 확인할 수 있다.

목록에 바로 나타나지 않으면 Widgets Board를 닫았다 다시 열고, 그래도 없으면 작업 관리자에서 `Windows Widgets`를 종료한 뒤 `Win + W`로 다시 시작한다. 패키지 상태는 다음으로 확인한다.

```powershell
Get-AppxPackage -Name MasterThesisOs.WidgetPoc
```

## 개발 중 갱신

소스 수정 뒤 같은 버전으로 다시 빌드·설치할 때:

```powershell
.\Package\Build-Package.ps1
.\Package\Install-Package.ps1
```

`Install-Package.ps1`는 `-ForceUpdateFromAnyVersion`을 사용한다. manifest/등록 정보를 바꾼 뒤 picker cache가 남으면 제거 후 재설치한다.

```powershell
.\Package\Uninstall-Package.ps1
.\Package\Install-Package.ps1
```

Visual Studio에서는 solution을 열고 x64를 선택한 뒤 project의 **Package and Publish** 또는 Deploy를 사용해도 된다. 고정된 위젯이 공급자 프로세스를 시작하므로 디버깅은 **Debug → Other Debug Targets → Debug Installed App Package**에서 package를 골라 `Do not launch, but debug my code when it starts`를 사용할 수 있다.

## 제거

패키지만 제거:

```powershell
.\Package\Uninstall-Package.ps1
```

패키지와 이 PoC의 개발 인증서를 함께 제거하려면 PowerShell을 관리자 권한으로 열고 실행한다.

```powershell
.\Package\Uninstall-Package.ps1 -RemoveCertificate
```

## 현재 기능과 제한

- medium 하나만 등록하며 `AllowMultiple=false`다.
- `CreateWidget`, `Activate`, `Deactivate`, `DeleteWidget`, context change와 template/data update를 구현했다.
- provider가 다시 시작되면 `GetWidgetInfos()`로 기존 인스턴스를 복구한다.
- 모든 콘텐츠가 static mock이다. polling, background refresh, 인증, DB/API 연결은 없다.
- 버튼은 Adaptive Card의 공식 `Action.OpenUrl`을 사용한다. provider-side action handler는 구현 범위 밖이다.
- x64만 대상으로 한다. ARM64/x86 package는 만들지 않는다.
- picker에 provider가 실제 표시되고 카드가 렌더링되는 최종 UI 확인은 Windows Widgets Board에서 수동으로 해야 한다.

## 다음 단계: 실제 Master Thesis OS 연결 지점

2차 단계에서는 `WidgetData.CreateMockJson()`을 데이터 adapter 호출로 교체하는 것이 주 연결점이다. `WidgetTemplate`과 manifest/COM 등록은 그대로 유지할 수 있다. 앱/API에서 task, next event, research progress를 받아 현재 `WidgetPayload` 형태로 변환한 뒤 `WidgetUpdateRequestOptions.Data`만 갱신한다. 인증·캐시·refresh 정책은 그때 별도로 설계하며, 기존 Next.js production 코드는 이번 PoC에서 전혀 수정하지 않았다.
