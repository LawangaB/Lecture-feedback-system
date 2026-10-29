-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'LECTURER', 'ADMIN');
CREATE TYPE "CourseRole" AS ENUM ('LECTURER', 'STUDENT');
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'ENDED');
CREATE TYPE "SessionAccessPolicy" AS ENUM ('ENROLLED_ONLY', 'ANY_SIGNED_IN');
CREATE TYPE "PollType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RATING');
CREATE TYPE "PollStatus" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED');
CREATE TYPE "ResultsVisibility" AS ENUM ('HIDDEN', 'LIVE', 'AFTER_CLOSE');
CREATE TYPE "FeedbackDimension" AS ENUM ('CLARITY', 'PACE', 'ENGAGEMENT', 'MATERIALS');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Course" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "ownerId" UUID NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Enrolment" (
    "courseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CourseRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrolment_pkey" PRIMARY KEY ("courseId","userId")
);

CREATE TABLE "LectureSession" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "accessPolicy" "SessionAccessPolicy" NOT NULL DEFAULT 'ENROLLED_ONLY',
    "joinCodeHash" TEXT,
    "joinCodeEnc" TEXT,
    "joinCodeExpiresAt" TIMESTAMPTZ(6),
    "feedbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduledFor" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LectureSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceRecord" (
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("sessionId","userId")
);

CREATE TABLE "Poll" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "type" "PollType" NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'DRAFT',
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "allowResponseUpdate" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "resultsVisibility" "ResultsVisibility" NOT NULL DEFAULT 'AFTER_CLOSE',
    "resultsRevealed" BOOLEAN NOT NULL DEFAULT false,
    "minSelections" INTEGER,
    "maxSelections" INTEGER,
    "ratingMin" INTEGER,
    "ratingMax" INTEGER,
    "durationSeconds" INTEGER,
    "openedAt" TIMESTAMPTZ(6),
    "closesAt" TIMESTAMPTZ(6),
    "remainingMs" INTEGER,
    "closedAt" TIMESTAMPTZ(6),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollOption" (
    "id" UUID NOT NULL,
    "pollId" UUID NOT NULL,
    "label" VARCHAR(300) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollParticipation" (
    "id" UUID NOT NULL,
    "pollId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollParticipation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollResponse" (
    "id" UUID NOT NULL,
    "pollId" UUID NOT NULL,
    "userId" UUID,
    "ratingValue" INTEGER,
    "submittedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PollResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollResponseOption" (
    "responseId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "pollId" UUID NOT NULL,

    CONSTRAINT "PollResponseOption_pkey" PRIMARY KEY ("responseId","optionId")
);

CREATE TABLE "FeedbackParticipation" (
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackParticipation_pkey" PRIMARY KEY ("sessionId","userId")
);

CREATE TABLE "FeedbackEntry" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "comment" VARCHAR(3000),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6),

    CONSTRAINT "FeedbackEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackRating" (
    "entryId" UUID NOT NULL,
    "dimension" "FeedbackDimension" NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "FeedbackRating_pkey" PRIMARY KEY ("entryId","dimension")
);

CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(80),
    "targetId" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");
CREATE INDEX "Course_ownerId_idx" ON "Course"("ownerId");
CREATE INDEX "Enrolment_userId_idx" ON "Enrolment"("userId");
CREATE UNIQUE INDEX "LectureSession_joinCodeHash_key" ON "LectureSession"("joinCodeHash");
CREATE INDEX "LectureSession_courseId_status_idx" ON "LectureSession"("courseId", "status");
CREATE INDEX "LectureSession_status_scheduledFor_idx" ON "LectureSession"("status", "scheduledFor");
CREATE INDEX "AttendanceRecord_userId_idx" ON "AttendanceRecord"("userId");
CREATE INDEX "Poll_sessionId_status_idx" ON "Poll"("sessionId", "status");
CREATE INDEX "Poll_status_closesAt_idx" ON "Poll"("status", "closesAt");
CREATE UNIQUE INDEX "PollOption_pollId_position_key" ON "PollOption"("pollId", "position");
CREATE UNIQUE INDEX "PollOption_id_pollId_key" ON "PollOption"("id", "pollId");
CREATE UNIQUE INDEX "PollParticipation_pollId_userId_key" ON "PollParticipation"("pollId", "userId");
CREATE INDEX "PollParticipation_userId_idx" ON "PollParticipation"("userId");
CREATE UNIQUE INDEX "PollResponse_id_pollId_key" ON "PollResponse"("id", "pollId");
CREATE INDEX "PollResponse_pollId_idx" ON "PollResponse"("pollId");
CREATE INDEX "PollResponseOption_optionId_idx" ON "PollResponseOption"("optionId");
CREATE INDEX "FeedbackEntry_sessionId_idx" ON "FeedbackEntry"("sessionId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "user_sessions_expire_idx" ON "user_sessions"("expire");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LectureSession" ADD CONSTRAINT "LectureSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LectureSession" ADD CONSTRAINT "LectureSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LectureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LectureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollParticipation" ADD CONSTRAINT "PollParticipation_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollParticipation" ADD CONSTRAINT "PollParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PollResponseOption" ADD CONSTRAINT "PollResponseOption_responseId_pollId_fkey" FOREIGN KEY ("responseId", "pollId") REFERENCES "PollResponse"("id", "pollId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollResponseOption" ADD CONSTRAINT "PollResponseOption_optionId_pollId_fkey" FOREIGN KEY ("optionId", "pollId") REFERENCES "PollOption"("id", "pollId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackParticipation" ADD CONSTRAINT "FeedbackParticipation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LectureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackParticipation" ADD CONSTRAINT "FeedbackParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackEntry" ADD CONSTRAINT "FeedbackEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LectureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackEntry" ADD CONSTRAINT "FeedbackEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "FeedbackEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defence-in-depth CHECK constraints (not modelled by Prisma; they do not cause schema drift).
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_value_range" CHECK ("value" BETWEEN 1 AND 5);
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_question_not_blank" CHECK (length(trim("question")) > 0);
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_selection_bounds" CHECK (
  ("minSelections" IS NULL OR "minSelections" >= 0)
  AND ("maxSelections" IS NULL OR "maxSelections" >= 1)
  AND ("minSelections" IS NULL OR "maxSelections" IS NULL OR "minSelections" <= "maxSelections"));
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_rating_bounds" CHECK ("ratingMin" IS NULL OR "ratingMax" IS NULL OR "ratingMax" > "ratingMin");
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_duration_positive" CHECK ("durationSeconds" IS NULL OR "durationSeconds" BETWEEN 5 AND 86400);
-- An anonymous poll can never carry user ids on responses (enforced in app logic; indexed here for audits).
ALTER TABLE "LectureSession" ADD CONSTRAINT "LectureSession_title_not_blank" CHECK (length(trim("title")) > 0);
