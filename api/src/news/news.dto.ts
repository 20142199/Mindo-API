import { Type } from 'class-transformer';
import { ArticleStatus, NewsContentType, NewsFeedbackType } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ListNewsDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() expert?: string;
  @IsOptional() @IsEnum(NewsContentType) type?: NewsContentType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

export class NewsSearchDto {
  @IsString() @MinLength(2) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 10;
}

export class SaveNewsArticleDto {
  @IsString() @MinLength(5) title!: string;
  @IsString() @MinLength(3) slug!: string;
  @IsString() summary!: string;
  @IsString() @MinLength(20) content!: string;
  @IsOptional() @IsUrl({ require_tld: false }) image_url?: string;
  @IsOptional() @IsUrl({ require_tld: false }) video_url?: string;
  @IsOptional() @IsUrl({ require_tld: false }) source_url?: string;
  @IsOptional() @IsEnum(NewsContentType) content_type?: NewsContentType;
  @IsOptional() @IsEnum(ArticleStatus) status?: ArticleStatus;
  @IsOptional() @IsString() topic_id?: string;
  @IsOptional() @IsString() expert_id?: string;
}

export class SaveNewsTopicDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(2) slug!: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}

export class SaveNewsExpertDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(2) slug!: string;
  @IsString() @MinLength(2) specialty!: string;
  @IsString() @MinLength(5) bio!: string;
  @IsOptional() @IsUrl({ require_tld: false }) avatar_url?: string;
  @IsOptional() @IsUrl({ require_tld: false }) cover_url?: string;
  @IsOptional() @IsString() @MaxLength(4) initials?: string;
  @IsOptional() @IsBoolean() is_verified?: boolean;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}

export class UpdateNewsSourceDto {
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(1440) crawl_interval_minutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) max_items_per_run?: number;
  @IsOptional() @IsString() topic_id?: string;
}

export class SetNewsInterestsDto {
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) topic_ids!: string[];
}

export class NewsFeedbackDto {
  @IsEnum(NewsFeedbackType) type!: NewsFeedbackType;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
