import { prisma } from '../database/connection.js';

export function saveQuestion({ userId, question, answer, found }) {
  return prisma.aiQuestion.create({
    data: { userId: BigInt(userId), question, answer, found },
  });
}

export function listUnanswered(limit = 15) {
  return prisma.aiQuestion.findMany({
    where: { found: false },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
