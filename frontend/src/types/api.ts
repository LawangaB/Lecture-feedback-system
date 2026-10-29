export type Role = 'STUDENT' | 'LECTURER' | 'ADMIN';
export type SessionStatus = 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'ENDED';
export type PollStatus = 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED';
export type PollType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'RATING';
export type ResultsVisibility = 'HIDDEN' | 'LIVE' | 'AFTER_CLOSE';
export type FeedbackDimension = 'CLARITY' | 'PACE' | 'ENGAGEMENT' | 'MATERIALS';

export interface User { id: string; email: string; displayName: string; role: Role }

export interface Course {
  id: string; code: string; title: string; description: string | null; isArchived: boolean;
  ownerName: string; studentCount: number; sessionCount: number; createdAt: string;
}

export interface Session {
  id: string;
  course: { id: string; code: string; title: string };
  title: string; description: string | null; status: SessionStatus;
  accessPolicy: 'ENROLLED_ONLY' | 'ANY_SIGNED_IN'; feedbackEnabled: boolean;
  scheduledFor: string | null; startedAt: string | null; endedAt: string | null; createdAt: string;
  joinCode?: string | null; joinCodeExpiresAt?: string | null;
  attendanceCount?: number; pollCount?: number;
}

export interface PollOption { id: string; label: string; position: number }
export interface Poll {
  id: string; sessionId: string; question: string; type: PollType; status: PollStatus;
  isAnonymous: boolean; allowResponseUpdate: boolean; isRequired: boolean;
  minSelections: number | null; maxSelections: number | null; ratingMin: number | null; ratingMax: number | null;
  durationSeconds: number | null; closesAt: string | null; remainingMs: number | null; position: number;
  options: PollOption[]; resultsVisible: boolean;
  // staff-only
  resultsVisibility?: ResultsVisibility; resultsRevealed?: boolean; responseCount?: number;
  // student-only
  hasResponded?: boolean; myResponse?: { optionIds: string[]; ratingValue: number | null } | null;
}

export interface PollResults {
  pollId: string; type: PollType; totalResponses: number; joinedParticipants: number; responseRate: number | null;
  options: { id: string; label: string; count: number; percentOfRespondents: number }[];
  rating: { min: number; max: number; average: number | null; distribution: { value: number; count: number }[] } | null;
}

export interface Snapshot {
  session: Session; access: 'LECTURER' | 'STUDENT' | 'ADMIN'; polls: Poll[]; results: Record<string, PollResults>;
  participants?: { joined: number; connected: number }; serverTime: string;
}

export interface FeedbackSummary {
  totalEntries: number; joinedParticipants: number; submissionRate: number | null; commentCount: number;
  dimensions: { dimension: FeedbackDimension; count: number; average: number | null; distribution: { value: number; count: number }[] }[];
}
export interface FeedbackItem {
  id: string; ratings: Partial<Record<FeedbackDimension, number>>; comment: string | null; isHidden: boolean;
  author: { displayName: string } | null; createdAt: string | null;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface AdminUser { id: string; email: string; displayName: string; role: Role; isActive: boolean; createdAt: string }
export interface AuditEvent { id: string; action: string; actor: { displayName: string; email: string } | null; targetType: string | null; targetId: string | null; metadata: Record<string, unknown>; at: string }
