/** One shared "could not check" notice for every mail source: plain words first, raw code folded away. */
export function MailErrorNotice({ message, code, onRetry }: { message: string; code: string | null; onRetry: () => void }) {
  return <div className="microsoft-mail-error-wrap">
    <div className="error microsoft-mail-error" role="alert">
      <b>메일을 확인하지 못했어요.</b> {message} 메일이 없는 게 아니라 확인하지 못한 상태예요.
      <details className="mail-error-details"><summary>진단 정보</summary>오류 코드: {code ?? 'unknown'}</details>
    </div>
    <button className="mini" onClick={onRetry} type="button">다시 시도</button>
  </div>;
}
