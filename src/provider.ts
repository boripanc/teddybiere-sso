import Provider, { type Configuration } from 'oidc-provider';
import { PgAdapter } from './adapter.js';
import { config } from './config.js';
import { loadSigningKeys } from './keys.js';
import { findUserById } from './users.js';

export async function createProvider(): Promise<Provider> {
  const configuration: Configuration = {
    adapter: PgAdapter,
    jwks: { keys: await loadSigningKeys() } as Configuration['jwks'],
    cookies: { keys: config.cookieKeys },

    async findAccount(_ctx, id) {
      const user = await findUserById(id);
      if (!user) return undefined;
      return {
        accountId: user.id,
        async claims() {
          return { sub: user.id, email: user.email, email_verified: true, name: user.name };
        },
      };
    },

    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name'],
    },
    scopes: ['openid', 'offline_access', 'email', 'profile'],

    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },

    features: {
      devInteractions: { enabled: false }, // we ship our own login page
      revocation: { enabled: true },
      introspection: { enabled: true },
      rpInitiatedLogout: { enabled: true },
    },

    // PKCE is mandatory for public apps (SPAs, mobile) and optional for apps with a secret.
    pkce: {
      required: (_ctx, client) => client.clientAuthMethod === 'none',
    },

    ttl: {
      AccessToken: 60 * 60, // 1 hour
      AuthorizationCode: 60, // 1 minute
      IdToken: 60 * 60,
      RefreshToken: 60 * 60 * 24 * 30, // 30 days
      Interaction: 60 * 60,
      Session: 60 * 60 * 24 * 14, // stay signed in for 14 days
      Grant: 60 * 60 * 24 * 30,
    },

    // Remember consent per app so users only approve once.
    loadExistingGrant: async (ctx) => {
      const grantId = ctx.oidc.result?.consent?.grantId || ctx.oidc.session!.grantIdFor(ctx.oidc.client!.clientId);
      if (grantId) return ctx.oidc.provider.Grant.find(grantId);
      return undefined;
    },
  };

  const provider = new Provider(config.issuer, configuration);
  provider.proxy = true; // runs behind Caddy, which sets X-Forwarded-* headers
  return provider;
}
