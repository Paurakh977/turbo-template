import {
  createParamDecorator,
  DynamicModule,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { HttpAdapterHost } from '@nestjs/core';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';

export const ALLOW_ANONYMOUS_KEY = 'PUBLIC';
export const AUTH_OPTIONS_TOKEN = 'AUTH_OPTIONS';

export const AllowAnonymous = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_ANONYMOUS_KEY, true);

export const Session = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request?.session;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: { auth: any },
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const session = await this.options.auth.api.getSession({
      headers: fromNodeHeaders(request.headers || {}),
    });

    request.session = session;
    request.user = session?.user ?? null;

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      ALLOW_ANONYMOUS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    if (!session) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}

@Injectable()
export class AuthModule implements OnModuleInit {
  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: { auth: any },
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit() {
    if (!this.options?.auth) return;

    const handler = toNodeHandler(this.options.auth);
    const httpAdapter = this.adapterHost.httpAdapter;

    // Register Better Auth handler on the raw HTTP adapter (runs before NestJS routing)
    httpAdapter.use((req: any, res: any, next: any) => {
      if (req.url?.startsWith('/api/auth')) {
        return handler(req, res, next);
      }
      next();
    });
  }

  static forRoot(options: {
    auth: any;
    disableTrustedOriginsCors?: boolean;
    bodyParser?: any;
  }): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      providers: [
        {
          provide: AUTH_OPTIONS_TOKEN,
          useValue: options,
        },
        {
          provide: APP_GUARD,
          useClass: AuthGuard,
        },
      ],
      exports: [AUTH_OPTIONS_TOKEN],
    };
  }
}
