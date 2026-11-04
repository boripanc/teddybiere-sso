export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function layout(title: string, body: string, opts: { wide?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · TeddyBiere SSO</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --card:#fff; --text:#1d1c1a; --muted:#6b6862; --accent:#b4572b; --border:#e3e0da; --err:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161513; --card:#22201d; --text:#efece6; --muted:#a19d95; --border:#38352f; --accent:#e07a48; --err:#f2b8b5; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; grid-template-columns:minmax(0, 1fr); background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif; padding:16px; }
  main { width:100%; min-width:0; justify-self:center; max-width:380px; background:var(--card); border:1px solid var(--border); border-radius:14px; padding:28px; }
  h1 { font-size:1.35rem; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 20px; }
  label { display:block; font-size:.9rem; margin:14px 0 6px; }
  input { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:transparent; color:inherit; font:inherit; }
  button { width:100%; margin-top:20px; padding:11px; border:0; border-radius:8px; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  a.secondary { display:block; text-align:center; margin-top:14px; color:var(--muted); }
  .error { color:var(--err); background:color-mix(in srgb, var(--err) 12%, transparent); padding:10px 12px; border-radius:8px; margin-bottom:8px; }
  ul { padding-left:20px; }
  main.wide { max-width:960px; align-self:start; }
  @media (max-width:600px) { main { padding:20px 16px; } body { padding:12px; } }
  body:has(main.wide) { place-items:start center; }
  nav { display:flex; gap:16px; align-items:center; margin-bottom:20px; flex-wrap:wrap; }
  nav a { color:var(--text); } nav .spacer { flex:1; }
  h2 { font-size:1.1rem; margin:28px 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:.92rem; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:500; }
  .table-wrap { overflow-x:auto; }
  .inline { display:inline; } .inline button, button.small { width:auto; margin:0; padding:5px 10px; font-size:.85rem; }
  button.ghost { background:transparent; color:var(--text); border:1px solid var(--border); }
  button.danger { background:transparent; color:var(--err); border:1px solid var(--err); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .notice { background:color-mix(in srgb, var(--accent) 14%, transparent); padding:12px; border-radius:8px; margin-bottom:16px; overflow-wrap:anywhere; }
  code { font-family:ui-monospace, monospace; font-size:.88em; }
  textarea { width:100%; min-height:70px; padding:8px; border:1px solid var(--border); border-radius:8px; background:transparent; color:inherit; font:13px ui-monospace, monospace; }
  .muted { color:var(--muted); } .badge { font-size:.75rem; border:1px solid var(--border); border-radius:99px; padding:1px 8px; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0 16px; }
  select { padding:9px; border:1px solid var(--border); border-radius:8px; background:transparent; color:inherit; font:inherit; }
</style>
</head>
<body><main${opts.wide ? ' class="wide"' : ''}>${body}</main></body>
</html>`;
}

export function loginPage(opts: { uid: string; clientName: string; email?: string; error?: string }): string {
  return layout(
    'Sign in',
    `<h1>Sign in</h1>
     <p class="sub">to continue to <strong>${esc(opts.clientName)}</strong></p>
     ${opts.error ? `<div class="error">${esc(opts.error)}</div>` : ''}
     <form method="post" action="/interaction/${esc(opts.uid)}/login" autocomplete="on">
       <label for="email">Email</label>
       <input id="email" name="email" type="email" required autofocus autocomplete="username" value="${esc(opts.email)}">
       <label for="password">Password</label>
       <input id="password" name="password" type="password" required autocomplete="current-password">
       <button type="submit">Sign in</button>
     </form>
     <a class="secondary" href="/interaction/${esc(opts.uid)}/abort">Cancel</a>`,
  );
}

export function consentPage(opts: { uid: string; clientName: string; scopes: string[] }): string {
  const labels: Record<string, string> = {
    openid: 'Confirm who you are',
    email: 'See your email address',
    profile: 'See your name',
    offline_access: 'Stay connected when you are not using it',
  };
  return layout(
    'Allow access',
    `<h1>Allow access?</h1>
     <p class="sub"><strong>${esc(opts.clientName)}</strong> would like to:</p>
     <ul>${opts.scopes.map((s) => `<li>${esc(labels[s] ?? s)}</li>`).join('')}</ul>
     <form method="post" action="/interaction/${esc(opts.uid)}/confirm">
       <button type="submit">Allow</button>
     </form>
     <a class="secondary" href="/interaction/${esc(opts.uid)}/abort">Deny</a>`,
  );
}
