import { type LeaderboardEntry, formatCurrency } from '../game';

type Props = {
  leaderboard: LeaderboardEntry[];
  playerName?: string;
  playerNetWorth?: number;
};

const medals = ['🥇', '🥈', '🥉'];
const rankColors = ['lb-gold', 'lb-silver', 'lb-bronze'];

function formatStreakLabel(streak: number) {
  if (streak >= 30) return `🔥 ${streak}-day streak`;
  if (streak >= 7) return `⚡ ${streak}-day streak`;
  return `${streak}-day streak`;
}

export default function Leaderboard({ leaderboard, playerName, playerNetWorth }: Props) {
  const playerRank = leaderboard.findIndex(e => e.name === playerName || e.name === 'You') + 1;

  return (
    <div className="lb-container">
      {/* Podium for top 3 */}
      {leaderboard.length >= 3 && (
        <div className="lb-podium">
          {/* 2nd */}
          <div className="lb-podium-slot lb-podium-2">
            <div className="lb-podium-avatar lb-avatar-silver">🥈</div>
            <div className="lb-podium-name">{leaderboard[1].name}</div>
            <div className="lb-podium-worth">{formatCurrency(leaderboard[1].netWorth)}</div>
            <div className="lb-podium-step lb-step-2" />
          </div>
          {/* 1st */}
          <div className="lb-podium-slot lb-podium-1">
            <div className="lb-podium-crown">👑</div>
            <div className="lb-podium-avatar lb-avatar-gold">🥇</div>
            <div className="lb-podium-name">{leaderboard[0].name}</div>
            <div className="lb-podium-worth">{formatCurrency(leaderboard[0].netWorth)}</div>
            <div className="lb-podium-step lb-step-1" />
          </div>
          {/* 3rd */}
          <div className="lb-podium-slot lb-podium-3">
            <div className="lb-podium-avatar lb-avatar-bronze">🥉</div>
            <div className="lb-podium-name">{leaderboard[2].name}</div>
            <div className="lb-podium-worth">{formatCurrency(leaderboard[2].netWorth)}</div>
            <div className="lb-podium-step lb-step-3" />
          </div>
        </div>
      )}

      {/* Full list */}
      <ol className="lb-list">
        {leaderboard.map((entry, index) => {
          const isYou = entry.name === playerName || entry.name === 'You';
          const topClass = index < 3 ? rankColors[index] : '';
          return (
            <li
              key={`${entry.name}-${index}`}
              className={`lb-row ${topClass} ${isYou ? 'lb-row-you' : ''}`}
            >
              <div className="lb-rank">
                {index < 3 ? medals[index] : <span className="lb-rank-num">#{index + 1}</span>}
              </div>
              <div className="lb-info">
                <span className="lb-name">{entry.name}{isYou ? ' (you)' : ''}</span>
                <span className="lb-streak">{formatStreakLabel(entry.streak)}</span>
              </div>
              <div className="lb-worth">
                <strong>{formatCurrency(entry.netWorth)}</strong>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Player's rank if not in top list */}
      {playerRank === 0 && playerNetWorth !== undefined && (
        <div className="lb-your-rank">
          <span>Your rank: unranked</span>
          <strong>{formatCurrency(playerNetWorth)}</strong>
        </div>
      )}
    </div>
  );
}
