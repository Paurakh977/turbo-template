import {
  createParamDecorator,
  DynamicModule,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

/**
 * Hermetic test double for '@thallesp/nestjs-better-auth'.
 *
 * The real package ships ESM-only (exports map has no CJS entry), which the
 * jest CJS runtime cannot parse. Unit/e2e tests never exercise its internals,
 * so we map it to this stub via jest moduleNameMapper and keep the suites
 * hermetic and fast.
 *
 * Surface used by apps/api source:
 *  - AllowAnonymous() decorator (app.controller, links.controller)
 *  - AuthGuard + Session() param decorator (notes/audit/users/rate-limit)
 *  - AuthModule.forRoot({...}) returning a DynamicModule (app.module)
 */

export const ALLOW_ANONYMOUS_KEY = 'better-auth:allow-anonymous';

export const AllowAnonymous = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_ANONYMOUS_KEY, true);

/** Stub guard: passes everything through, no session resolution. */
export class AuthGuard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

/**
 * Stub param decorator: yields the request's session slot (undefined in
 * tests - suites that need one set it on the request directly).
 */
export const Session = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request?.session;
  },
);

export class AuthModule {
  static forRoot(_options: unknown): DynamicModule {
    return { module: AuthModule };
  }
}
