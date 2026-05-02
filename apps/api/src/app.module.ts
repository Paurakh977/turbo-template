import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from '@repo/auth';

import { LinksModule } from './links/links.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';

@Module({
  imports: [AuthModule.forRoot({ auth }), LinksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
