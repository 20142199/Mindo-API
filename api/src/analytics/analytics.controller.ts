import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';
import { ok } from '../common/api-response';
import { AnalyticsService } from './analytics.service';

@ApiTags('Admin analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.COMPLIANCE)
  @Get()
  report(@Query('from') from?: string, @Query('to') to?: string, @Query('granularity') granularity?: string) {
    return this.analytics.report(from, to, granularity).then((data) => ok(data));
  }
}

