/** Entry point kept for a feature whose server-side connection is still pending. */
export function EmptyFeature({ title, message }: { title: string; message: string }) {
  return <section className="card section empty-feature" role="status">
    <div className="head"><h3>{title}</h3><span>준비 중</span></div>
    <div className="empty compact-empty">{message}</div>
  </section>;
}
