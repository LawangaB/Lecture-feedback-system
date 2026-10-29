/**
 * DEVELOPMENT SEED ONLY. Creates clearly labelled test accounts and sample data.
 * Refuses to run when NODE_ENV=production.
 */
import { env } from '../src/config/env.ts';
import { prisma } from '../src/db.ts';
import { encryptText, hashJoinCode } from '../src/utils/crypto.ts';
import { hashPassword } from '../src/utils/password.ts';

if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database.');

const DEV_PASSWORD = 'DevPassword!2026'; // development only — printed below, never used outside seeded dev data
const passwordHash = await hashPassword(DEV_PASSWORD);

async function user(email: string, displayName: string, role: 'STUDENT' | 'LECTURER' | 'ADMIN', updateDisplayName = false) {
  return prisma.user.upsert({ where: { email }, update: updateDisplayName ? { displayName } : {}, create: { email, displayName, role, passwordHash } });
}

const admin = await user('admin@lectures.test', 'Administrator', 'ADMIN', true);
const lecturer = await user('lecturer@lectures.test', 'Dr. Pahan Senanayake', 'LECTURER', true);
const names = ['Nimal Perera', 'Ayesha Fernando', 'Kasun Silva', 'Dilini Jayasuriya', 'Tharindu Bandara', 'Sanduni Wickrama'];
const students = await Promise.all(names.map((n, i) => user(`student${i + 1}@lectures.test`, n, 'STUDENT')));

const course = await prisma.course.upsert({
  where: { code: 'CS2040' },
  update: {},
  create: {
    code: 'CS2040', title: 'Database Systems', description: 'Relational modelling, SQL and transactions.', ownerId: lecturer.id,
    enrolments: { create: [{ userId: lecturer.id, role: 'LECTURER' }, ...students.map((s: (typeof students)[number]) => ({ userId: s.id, role: 'STUDENT' as const }))] },
  },
});

const existing = await prisma.lectureSession.count({ where: { courseId: course.id } });
if (existing === 0) {
  // 1) A finished session with polls, responses and feedback.
  const past = await prisma.lectureSession.create({
    data: { courseId: course.id, createdById: lecturer.id, title: 'Week 3 — Normalisation', status: 'ENDED', startedAt: new Date(Date.now() - 7 * 864e5), endedAt: new Date(Date.now() - 7 * 864e5 + 3e6) },
  });
  await prisma.attendanceRecord.createMany({ data: students.slice(0, 5).map((s: (typeof students)[number]) => ({ sessionId: past.id, userId: s.id })) });
  const poll = await prisma.poll.create({
    data: {
      sessionId: past.id, createdById: lecturer.id, question: 'Which normal form removes partial dependencies?', type: 'SINGLE_CHOICE', status: 'CLOSED',
      isAnonymous: true, resultsVisibility: 'AFTER_CLOSE', openedAt: new Date(), closedAt: new Date(), position: 0,
      options: { create: ['1NF', '2NF', '3NF', 'BCNF'].map((label, position) => ({ label, position })) },
    },
    include: { options: true },
  });
  const pick = [1, 1, 1, 2, 0];
  for (const [i, s] of students.slice(0, 5).entries()) {
    await prisma.pollParticipation.create({ data: { pollId: poll.id, userId: s.id, idempotencyKey: `seed-${i}-xxxxxxxx` } });
    const r = await prisma.pollResponse.create({ data: { pollId: poll.id } }); // anonymous: no user id, no timestamp
    await prisma.pollResponseOption.create({ data: { responseId: r.id, optionId: poll.options[pick[i] as number]!.id, pollId: poll.id } });
  }
  for (const [i, s] of students.slice(0, 3).entries()) {
    await prisma.feedbackParticipation.create({ data: { sessionId: past.id, userId: s.id } });
    await prisma.feedbackEntry.create({
      data: { sessionId: past.id, comment: i === 0 ? 'Could we see one more worked example of 3NF?' : null, ratings: { create: [{ dimension: 'CLARITY', value: 4 - (i % 2) }, { dimension: 'PACE', value: 3 + (i % 2) }] } },
    });
  }
  // 2) A live session ready to demo (join code printed below).
  const code = 'DEMO42';
  await prisma.lectureSession.create({
    data: {
      courseId: course.id, createdById: lecturer.id, title: 'Week 4 — Transactions & Isolation', status: 'LIVE', startedAt: new Date(),
      joinCodeHash: hashJoinCode(code), joinCodeEnc: encryptText(code), joinCodeExpiresAt: new Date(Date.now() + 36e5 * 6),
    },
  });
  // 3) An upcoming session.
  await prisma.lectureSession.create({ data: { courseId: course.id, createdById: lecturer.id, title: 'Week 5 — Indexing', scheduledFor: new Date(Date.now() + 2 * 864e5) } });
  console.log(`Live demo session join code: ${code} (dev seed only)`);
}

console.log('\nDEV SEED COMPLETE — test accounts (password for all: %s)', DEV_PASSWORD);
console.log(`  admin     ${admin.email}\n  lecturer  ${lecturer.email}\n  students  student1@lectures.test … student6@lectures.test\n`);
await prisma.$disconnect();
