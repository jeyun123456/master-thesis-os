'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '@/app/reward-slot.module.css';

type Reward = {
  icon: string;
  label: string;
  weight: number;
};

type RewardHistory = {
  label: string;
  icon: string;
  at: string;
};

type RewardState = {
  completionDate: string;
  completedTasks: string[];
  credits: number;
  history: RewardHistory[];
};

type RewardSlotPanelProps = {
  tasks: string[];
  projectTitle: string;
  onNotice?: (message: string) => void;
};

const STORAGE_KEY = 'masterThesisOS.rewardSlot.v1';
const SPIN_DURATION_MS = 1100;
const REEL_TICK_MS = 85;

const rewards: Reward[] = [
  { icon: '🎮', label: '게임 30분', weight: 24 },
  { icon: '📺', label: '유튜브 20분', weight: 20 },
  { icon: '☕', label: '간식 / 카페', weight: 16 },
  { icon: '🛋️', label: '아무것도 안 하기 20분', weight: 18 },
  { icon: '🎲', label: '자유시간 30분', weight: 17 },
  { icon: '⭐', label: '자유시간 60분', weight: 5 },
];

function seoulDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function emptyState(): RewardState {
  return {
    completionDate: seoulDateKey(),
    completedTasks: [],
    credits: 0,
    history: [],
  };
}

function loadState(): RewardState {
  const today = seoulDateKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<RewardState>;
    const sameDay = parsed.completionDate === today;
    return {
      completionDate: today,
      completedTasks: sameDay && Array.isArray(parsed.completedTasks)
        ? parsed.completedTasks.filter((item): item is string => typeof item === 'string')
        : [],
      credits: typeof parsed.credits === 'number' && Number.isFinite(parsed.credits)
        ? Math.max(0, Math.floor(parsed.credits))
        : 0,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((item): item is RewardHistory => Boolean(item && typeof item.label === 'string' && typeof item.icon === 'string' && typeof item.at === 'string')).slice(0, 5)
        : [],
    };
  } catch {
    return emptyState();
  }
}

function pickReward() {
  const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const reward of rewards) {
    cursor -= reward.weight;
    if (cursor < 0) return reward;
  }
  return rewards[rewards.length - 1];
}

function randomIcon() {
  return rewards[Math.floor(Math.random() * rewards.length)].icon;
}

export function RewardSlotPanel({ tasks, projectTitle, onNotice }: RewardSlotPanelProps) {
  const [state, setState] = useState<RewardState>(emptyState);
  const [ready, setReady] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [reels, setReels] = useState(['🎲', '🎲', '🎲']);
  const [result, setResult] = useState('');
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const spinningRef = useRef(false);

  useEffect(() => {
    setState(loadState());
    setReady(true);
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Embedded wallpaper runtimes can deny storage. The slot still works
      // for the current session even when persistence is unavailable.
    }
  }, [ready, state]);

  function completeTask(task: string) {
    if (!ready || state.completedTasks.includes(task)) return;
    setState((current) => ({
      ...current,
      completedTasks: [...current.completedTasks, task],
      credits: current.credits + 1,
    }));
    onNotice?.('작업 완료 · 슬롯 1회 충전!');
  }

  function spin() {
    if (!ready || state.credits < 1 || spinningRef.current) return;
    spinningRef.current = true;
    setSpinning(true);
    setResult('');
    setState((current) => ({ ...current, credits: Math.max(0, current.credits - 1) }));

    intervalRef.current = window.setInterval(() => {
      setReels([randomIcon(), randomIcon(), randomIcon()]);
    }, REEL_TICK_MS);

    timeoutRef.current = window.setTimeout(() => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
      const reward = pickReward();
      setReels([reward.icon, reward.icon, reward.icon]);
      setResult(`${reward.icon} ${reward.label}`);
      setState((current) => ({
        ...current,
        history: [{ label: reward.label, icon: reward.icon, at: new Date().toISOString() }, ...current.history].slice(0, 5),
      }));
      spinningRef.current = false;
      setSpinning(false);
      onNotice?.(`당첨 · ${reward.label}`);
    }, SPIN_DURATION_MS);
  }

  return (
    <div className="grid2 section-gap">
      <div className="card section">
        <div className="head">
          <h3>바로 다음 작업</h3>
          <span>{projectTitle}</span>
        </div>
        {tasks.length ? (
          <div className="numbered-list">
            {tasks.map((task, index) => {
              const completed = state.completedTasks.includes(task);
              return (
                <div className={`numbered-item ${styles.rewardTask} ${completed ? styles.completedTask : ''}`} key={`${index}-${task}`}>
                  <span>{completed ? '✓' : index + 1}</span>
                  <p>{task}</p>
                  <button
                    className={styles.completeButton}
                    type="button"
                    disabled={!ready || completed}
                    onClick={() => completeTask(task)}
                  >
                    {completed ? '완료됨' : '완료 +1'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty compact-empty">활성 프로젝트의 다음 작업을 표시해.</div>
        )}
        <p className={styles.localHint}>완료 체크는 보상용 로컬 기록이야. 원본 project.md는 바꾸지 않아.</p>
      </div>

      <div className={`card section ${styles.slotCard}`}>
        <div className="head">
          <h3>작업 보상 슬롯</h3>
          <span>남은 슬롯 {ready ? state.credits : 0}회</span>
        </div>
        <div className={styles.slotMachine} aria-label="보상 슬롯">
          {reels.map((reel, index) => (
            <div className={`${styles.reel} ${spinning ? styles.spinning : ''}`} key={index}>{reel}</div>
          ))}
        </div>
        <div className={styles.resultArea} aria-live="polite">
          <b>{result || (state.credits > 0 ? '한 번 돌려볼까?' : '작업 하나 끝내면 슬롯이 충전돼.')}</b>
          <small>작업 완료 1개 = 슬롯 1회 · 미사용 슬롯은 유지</small>
        </div>
        <button className={`btn primary ${styles.spinButton}`} type="button" disabled={!ready || spinning || state.credits < 1} onClick={spin}>
          {spinning ? '돌아가는 중…' : state.credits > 0 ? `슬롯 돌리기 · ${state.credits}회` : '슬롯 없음'}
        </button>
        {state.history.length > 0 && (
          <div className={styles.history}>
            <span>최근 당첨</span>
            {state.history.slice(0, 3).map((item, index) => <small key={`${item.at}-${index}`}>{item.icon} {item.label}</small>)}
          </div>
        )}
      </div>
    </div>
  );
}
