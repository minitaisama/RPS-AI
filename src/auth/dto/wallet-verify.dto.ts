import { IsString, Matches } from 'class-validator';

export class WalletVerifyDto {
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  walletAddress: string;

  @IsString()
  signature: string;

  @IsString()
  nonce: string;
}
