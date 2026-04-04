export interface Task {
  id: string;
  title: string;
  status: 'backlog' | 'in-progress' | 'completed';
  createdAt: string;
  description?: string;
  screenshots?: string[];
  order?: number;
}

export interface Project {
  id: string;
  name: string;
  tasks: Task[];
  screenshots: string[]; // base64 data URLs
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  type: 'project' | 'task' | 'log' | 'custom';
  title: string;
  description: string;
  image?: string;
  projectName?: string;
  timestamp: string;
}

const KEYS = {
  projects: 'devlog_projects',
  notes: 'devlog_notes',
  timeline: 'devlog_timeline',
};

function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const store = {
  getProjects: (): Project[] => get(KEYS.projects, []),
  saveProjects: (p: Project[]) => set(KEYS.projects, p),

  getNotes: (): Note[] => get(KEYS.notes, []),
  saveNotes: (n: Note[]) => set(KEYS.notes, n),

  getTimeline: (): TimelineEvent[] => get(KEYS.timeline, []),
  saveTimeline: (t: TimelineEvent[]) => set(KEYS.timeline, t),

  addTimelineEvent: (event: Omit<TimelineEvent, 'id' | 'timestamp'>) => {
    const timeline = get<TimelineEvent[]>(KEYS.timeline, []);
    const newEvent: TimelineEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    timeline.unshift(newEvent);
    set(KEYS.timeline, timeline);
    return newEvent;
  },

  uid: () => crypto.randomUUID(),
};
