import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';

/**
 * Test-only OAuth mock endpoints, mounted inside the integration-test app so
 * the dummy generic OAuth provider (see packages/auth/src/auth.ts) can complete
 * its token + userinfo exchange fully in-process — no external network, no
 * nock (which cannot intercept undici/fetch in Node 22).
 *
 * The flow: the test triggers /callback/dummy with `code = <email>`. The token
 * endpoint echoes that code back as the access_token; the userinfo endpoint
 * reads `Authorization: Bearer <code>` and returns a profile for that email.
 * This lets each test control exactly which account the OAuth identity links
 * to, enabling the account-linking assertions.
 *
 * Validation is disabled here so the plain-object bodies aren't stripped by the
 * app's global whitelist ValidationPipe.
 */
@Controller('dummy')
@UsePipes(new ValidationPipe({ transform: true, whitelist: false, forbidNonWhitelisted: false }))
export class DummyOAuthController {
  @Post('token')
  @Public()
  token(@Body() body: { code?: string }) {
    // The `code` IS the email for the test account (echoed back as the token).
    const code = body?.code ?? '';
    return {
      access_token: code,
      token_type: 'Bearer',
      expires_in: 3600,
    };
  }

  @Get('userinfo')
  @Public()
  userinfo(@Headers('authorization') authorization: string) {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '');
    // The `code`/access_token IS the email for the test account.
    const email = token.startsWith('user:') ? token.slice(5) : token;
    return {
      id: `dummy-${email}`,
      email,
      email_verified: true,
      name: 'Dummy User',
      picture: 'https://example.com/avatar.png',
    };
  }
}
