export function Brand({ href = "/" }: { href?: string }) {
  return <a className="brand" href={href}>
    <img src="/bot-logo.avif" alt="" width={32} height={32}/>
    <span>GOPlay</span>
  </a>;
}
