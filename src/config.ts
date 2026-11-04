function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  // Public URL of the SSO server, e.g. https://sso.example.com
  issuer: required('ISSUER', isProd ? undefined : 'http://localhost:3000'),
  databaseUrl: required('DATABASE_URL', isProd ? undefined : 'postgres://postgres@localhost:5432/sso'),
  // Comma-separated secrets used to sign cookies. First one signs, all verify (allows rotation).
  cookieKeys: required('COOKIE_KEYS', isProd ? undefined : 'dev-only-change-me').split(',').map((s) => s.trim()),
};
