// `getSeasonLeaderboardLimit` removed (2026-08-12).
// Historically this exported a value of 20 based on a mistaken assumption
// about upstream leaderboard page sizes. Testing showed the upstream
// /origins/v2/season-leaderboards endpoint accepts larger limits (50,100)
// so the hard-coded 20 was removed as it was unused and misleading.
