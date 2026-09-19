import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VietQrCallbackDto } from './phase1.dto';
import { Phase1Service } from './phase1.service';
import { VietQrService } from './vietqr.service';

@ApiTags('VietQR callback')
@Controller('vqr')
export class VietQrController {
  constructor(
    private readonly vietQr: VietQrService,
    private readonly phase1: Phase1Service,
  ) {}

  @Post('api/token_generate')
  token(@Headers('authorization') authorization: string | undefined) {
    return this.vietQr.issueCallbackToken(authorization);
  }

  @Post('bank/api/transaction-sync')
  async sync(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: VietQrCallbackDto,
  ) {
    await this.vietQr.assertCallbackAuthorization(authorization);
    const deposit = await this.phase1.syncVietQrPayment(dto);
    return {
      error: false,
      errorReason: '',
      toastMessage: '',
      object: { reftransactionid: deposit.bankTransactionId ?? '' },
    };
  }
}
