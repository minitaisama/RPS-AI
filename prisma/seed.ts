import { PrismaClient, StrategyStatus, StrategyType } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

const presets = [
  {
    name: 'Aggressive',
    presetKey: 'aggressive',
    compiledJs: "(input) => { const r = input.currentRound % 3; return ['rock','rock','scissors'][r]; }",
  },
  {
    name: 'Defensive',
    presetKey: 'defensive',
    compiledJs:
      "(input) => { if (input.opponentHistory.length === 0) return 'rock'; const last = input.opponentHistory[input.opponentHistory.length - 1]; return { rock: 'paper', paper: 'scissors', scissors: 'rock' }[last]; }",
  },
  {
    name: 'Copycat',
    presetKey: 'copycat',
    compiledJs:
      "(input) => { if (input.opponentHistory.length === 0) return 'rock'; return input.opponentHistory[input.opponentHistory.length - 1]; }",
  },
  {
    name: 'Chaotic',
    presetKey: 'chaotic',
    compiledJs:
      "(input) => { return ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)]; }",
  },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { walletAddress: '0x1111111111111111111111111111111111111111' },
    update: {},
    create: {
      walletAddress: '0x1111111111111111111111111111111111111111',
      displayName: 'Dev Player',
    },
  });

  for (const preset of presets) {
    const promptHash = createHash('sha256').update(`${user.id}:${preset.presetKey}`).digest('hex');
    const existing = await prisma.strategy.findFirst({
      where: {
        userId: user.id,
        presetKey: preset.presetKey,
      },
    });

    if (existing) {
      await prisma.strategy.update({
        where: { id: existing.id },
        data: {
          name: preset.name,
          compiledJs: preset.compiledJs,
          promptHash,
          status: StrategyStatus.ACTIVE,
          isActive: preset.presetKey === 'aggressive',
          smokeTestPassed: true,
        },
      });
      continue;
    }

    await prisma.strategy.create({
      data: {
        userId: user.id,
        name: preset.name,
        type: StrategyType.PRESET,
        presetKey: preset.presetKey,
        compiledJs: preset.compiledJs,
        promptHash,
        status: StrategyStatus.ACTIVE,
        isActive: preset.presetKey === 'aggressive',
        smokeTestPassed: true,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
