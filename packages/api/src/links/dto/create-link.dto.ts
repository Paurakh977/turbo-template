import { IsString, IsUrl, IsOptional, MaxLength } from 'class-validator';

export class CreateLinkDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
