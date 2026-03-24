import { IsString, Matches } from 'class-validator';

export class WalletLoginDto {
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  walletAddress: string;
}
