const API_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200";

// Change only these two.
const HOME_TEAM = "ENG";
const AWAY_TEAM = "ARG";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_FIRST_HALF_ADDED_TIME_BADGE = 1;
const DEFAULT_SECOND_HALF_ADDED_TIME_BADGE = 6;

window.__WC_DEMO_MODE__ = false;

const TEAM_ALIASES = {
  SPA: "ESP",
  SPN: "ESP",
  SPAIN: "ESP",
  URUGUAY: "URU",
  CONGO: "COD",
  DRC: "COD",
  "DR CONGO": "COD"
};

const ESPN_HOME_TEAM = normalizeTeamCode(HOME_TEAM);
const ESPN_AWAY_TEAM = normalizeTeamCode(AWAY_TEAM);

const FIFA_TO_ISO2 = {
  ENG:"GB", COD:"CD", RSA:"ZA", CAN:"CA", URU:"UY", ESP:"ES", SPA:"ES", SEN:"SN", IRQ:"IQ",
  NOR:"NO", FRA:"FR", ARG:"AR", BRA:"BR", GER:"DE", ITA:"IT", POR:"PT", NED:"NL", USA:"US",
  MEX:"MX", MAR:"MA", QAT:"QA", JPN:"JP", KOR:"KR", GHA:"GH", WAL:"GB", POL:"PL", TUN:"TN",
  DEN:"DK", AUS:"AU", CRO:"HR", SRB:"RS", SUI:"CH", CMR:"CM", BEL:"BE", CRC:"CR", ECU:"EC",
  KSA:"SA", IRN:"IR"
};

const DEFAULT_AVATAR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="48" fill="#0b0c0e" stroke="#ffd700" stroke-width="4"/>
    <circle cx="50" cy="40" r="18" fill="#ff4b60"/>
    <path d="M20 82c0-14 12-23 30-23s30 9 30 23z" fill="#8a3ffc"/>
  </svg>`);

const VERSION_CHECK_INTERVAL_MS = 10000;
const VERSION_FILE_URL = "/version.txt";
let knownVersion = null;

const DEFAULT_SHIELD_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <path d="M50 5L15 20v35c0 20 15 35 35 40 20-5 35-20 35-40V20z" fill="#0b0c0e" stroke="#ffd700" stroke-width="4"/>
    <circle cx="50" cy="48" r="16" fill="#00f0c5"/>
  </svg>`);

const PAGE_VERSION_URL = "/version.txt";
const PAGE_VERSION_POLL_MS = 1000;
let knownPageVersion = null;
let livePollIntervalId = null;
let pendingGoalTimeouts = [];
let matchTimer = null;
let goalEventManager = null;
let redCardTracker = null;

function normalizeTeamCode(code) {
  const clean = String(code || "").trim().toUpperCase();
  return TEAM_ALIASES[clean] || clean;
}

function parseScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 ? score : null;
}

function getFallbackFlag(teamAbbr) {
  const code = normalizeTeamCode(teamAbbr);
  const iso2 = FIFA_TO_ISO2[code] || FIFA_TO_ISO2[teamAbbr];
  return iso2 ? `https://flagcdn.com/w160/${iso2.toLowerCase()}.png` : DEFAULT_SHIELD_SVG;
}

function safeLoadImage(imgElement, primaryUrl, fallbackUrls = [], onResolved = null) {
  if (!imgElement) return;

  const urls = [...new Set(
    [primaryUrl, ...fallbackUrls]
      .map(url => typeof url === "string" ? url.trim() : "")
      .filter(Boolean)
  )];

  const hardFallback = imgElement.id === "alert-team-flag" ? DEFAULT_AVATAR_SVG : DEFAULT_SHIELD_SVG;
  if (!urls.includes(hardFallback)) urls.push(hardFallback);

  let index = 0;

  function tryNext() {
    if (index >= urls.length) {
      imgElement.onerror = null;
      imgElement.onload = null;
      imgElement.src = hardFallback;
      if (typeof onResolved === "function") onResolved(hardFallback);
      return;
    }

    const next = urls[index++];
    imgElement.onerror = tryNext;
    imgElement.onload = () => {
      imgElement.onerror = null;
      if (typeof onResolved === "function") onResolved(next);
    };
    imgElement.src = next;
  }

  tryNext();
}

function buildScorerImageCandidates({ athleteId, espnHeadshot, scorerName, teamAbbr }) {
  const code = normalizeTeamCode(teamAbbr);
  const candidates = [];

  if (espnHeadshot) candidates.push(espnHeadshot);

  if (athleteId) {
    candidates.push(`https://a.espncdn.com/i/headshots/soccer/players/full/${athleteId}.png`);
    candidates.push(`https://a.espncdn.com/i/headshots/soccer/players/full/${athleteId}.jpg`);
  }

  candidates.push(`https://a.espncdn.com/i/teamlogos/countries/500/${code.toLowerCase()}.png`);
  candidates.push(getFallbackFlag(code));

  if (scorerName) {
    candidates.push(`https://ui-avatars.com/api/?name=${encodeURIComponent(scorerName)}&background=0b0c0e&color=ffffff&size=256&bold=true&format=png`);
  }

  candidates.push(DEFAULT_AVATAR_SVG);
  return [...new Set(candidates.filter(Boolean))];
}

function cleanHexColor(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.replace(/^#+/, "");
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return `#${normalized.split("").map(c => c + c).join("")}`;
  }
  return null;
}

function getTeamKitColor(team, isHome) {
  if (!team || typeof team !== "object") return null;
  const primary = cleanHexColor(team.color || team.primaryColor || team.teamColor || team.backgroundColor);
  const alternate = cleanHexColor(team.alternateColor || team.secondaryColor || team.secondaryColour);
  if (isHome) {
    return primary || alternate || null;
  }
  return alternate || primary || null;
}

function applyTeamStatusDotColors(homeCompetitor, awayCompetitor) {
  // Keep CSS-based status-dot colors and do not override them with inline styles.
}

/* =========================
   TIMER
========================= */

const MatchState = Object.freeze({
  PRE_MATCH: "PRE_MATCH",
  FIRST_HALF: "FIRST_HALF",
  HALF_TIME: "HALF_TIME",
  SECOND_HALF: "SECOND_HALF",
  EXTRA_TIME: "EXTRA_TIME",
  FULL_TIME: "FULL_TIME"
});

class MatchTimer {
  constructor({ clockEl, stoppageModuleEl, stoppageClockEl, stoppageIncrementEl }) {
    this.clockEl = clockEl;
    this.stoppageModuleEl = stoppageModuleEl;
    this.stoppageClockEl = stoppageClockEl;
    this.stoppageIncrementEl = stoppageIncrementEl;

    this.state = MatchState.PRE_MATCH;
    this.currentSeconds = 0;
    this.lastTickMs = null;
    this.running = false;
    this.lastPeriod = null;
    this.lastApiMinute = null;
    this.addedTimeActive = false;
    this.addedTimeBadgeMinutes = 0;
    this.addedTimeBadgeSource = null;

    setInterval(() => this.tick(), 1000);
  }

  updateFromApi(match, competition) {
    const status = match?.status || {};
    const type = status?.type || {};

    const apiState = String(type.state || "").toLowerCase();
    const apiName = String(type.name || "").toUpperCase();
    const apiDesc = String(type.description || "").toLowerCase();
    const detail = String(status.detail || status.shortDetail || "").toLowerCase();
    const completed = Boolean(type.completed || status.completed);
    const period = Number(status.period || 0);
    const rawClock = String(status.displayClock || "").trim();

    if (period && this.lastPeriod !== null && period !== this.lastPeriod) {
      this.resetPeriodState();
    }

    if (period) this.lastPeriod = period;

    const isFinal =
      completed ||
      apiState === "post" ||
      apiName.includes("FINAL") ||
      apiName.includes("STATUS_FINAL") ||
      apiDesc.includes("final") ||
      detail.includes("final") ||
      detail.includes("full time");

    if (isFinal) {
      this.stopAtStateText("FT", this.currentSeconds || 90 * 60);
      return;
    }

    const isPre =
      apiState === "pre" ||
      apiName.includes("SCHEDULED") ||
      apiName.includes("STATUS_SCHEDULED");

    if (isPre) {
      this.stopAtStateText("SCHED", 0);
      return;
    }

    const isHalfTime =
      apiName.includes("HALFTIME") ||
      apiName.includes("STATUS_HALFTIME") ||
      apiDesc.includes("halftime") ||
      detail.includes("halftime");

    if (isHalfTime) {
      this.stopAtStateText("HT", 45 * 60);
      return;
    }

    this.state =
      period === 1 ? MatchState.FIRST_HALF :
      period === 2 ? MatchState.SECOND_HALF :
      period >= 3 ? MatchState.EXTRA_TIME :
      MatchState.SECOND_HALF;

    const parsed = this.parseClock(rawClock, period);
    if (!parsed) return;

    this.clockEl?.classList.remove("state-text");

    const officialAdded = this.findOfficialAddedTime(competition, period);

    if (parsed.isAddedTime) {
      this.syncAddedTime(parsed, officialAdded, period);
    } else {
      this.syncNormalMinute(parsed.minute, period, officialAdded);
    }

    this.running = true;
    if (this.lastTickMs === null) this.lastTickMs = Date.now();

    this.render();
  }

  parseClock(rawClock, period) {
    if (!rawClock) return null;

    const clean = rawClock.replace(/['"]/g, "").trim();

    if (clean.includes("+")) {
      const [basePart, addedPart] = clean.split("+");
      return {
        isAddedTime: true,
        baseMinute: this.normalizeAddedTimeBaseMinute(this.readFirstNumber(basePart), period),
        addedMinuteFromApi: this.readFirstNumber(addedPart) || 0
      };
    }

    const apiMinuteLabel = this.readFirstNumber(clean);

    return {
      isAddedTime: false,
      minute: this.convertSoccerMinuteLabelToElapsedMinute(apiMinuteLabel)
    };
  }

  readFirstNumber(value) {
    const match = String(value || "").match(/\d+/);
    if (!match) return null;

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  convertSoccerMinuteLabelToElapsedMinute(apiMinuteLabel) {
    if (apiMinuteLabel === null) return null;
    return apiMinuteLabel > 0 ? apiMinuteLabel - 1 : 0;
  }

  normalizeAddedTimeBaseMinute(apiBaseMinute, period) {
    const expectedBase = this.getPeriodBaseMinute(period);

    if (
      apiBaseMinute === 45 ||
      apiBaseMinute === 90 ||
      apiBaseMinute === 105 ||
      apiBaseMinute === 120
    ) {
      return apiBaseMinute;
    }

    return expectedBase;
  }

  getPeriodBaseMinute(period) {
    if (period === 1) return 45;
    if (period === 2) return 90;
    if (period === 3) return 105;
    if (period === 4) return 120;
    return 90;
  }

  getFallbackAddedBadge(period) {
    if (period === 1) return DEFAULT_FIRST_HALF_ADDED_TIME_BADGE;
    if (period === 2) return DEFAULT_SECOND_HALF_ADDED_TIME_BADGE;
    if (period === 3) return 1;
    if (period === 4) return 1;
    return 0;
  }

  setAddedTimeBadge(officialAdded, fallbackBadge, parsedAddedMinute) {
    // Official announcement may override fallback once. After that, the badge stays fixed.
    if (officialAdded && this.addedTimeBadgeSource !== "official") {
      this.addedTimeBadgeMinutes = officialAdded;
      this.addedTimeBadgeSource = "official";
      return;
    }

    if (!this.addedTimeBadgeMinutes) {
      this.addedTimeBadgeMinutes = fallbackBadge || parsedAddedMinute || 0;
      this.addedTimeBadgeSource = fallbackBadge ? "fallback" : "api";
    }
  }

  syncNormalMinute(apiMinute, period, officialAdded) {
    if (apiMinute === null) return;

    const baseMinute = this.getPeriodBaseMinute(period);
    const apiStart = apiMinute * 60;
    const apiEnd = apiStart + 59;
    const firstSync = this.lastApiMinute === null || this.lastTickMs === null;

    if (firstSync) {
      this.currentSeconds = apiStart;
      this.lastApiMinute = apiMinute;
      this.lastTickMs = Date.now();
      return;
    }

    const localInsideApiMinute =
      this.currentSeconds >= apiStart &&
      this.currentSeconds <= apiEnd;

    if (localInsideApiMinute) {
      this.lastApiMinute = apiMinute;
      return;
    }

    const apiMinuteAdvanced = apiMinute > this.lastApiMinute;
    const apiMinuteWentBackward = apiMinute < this.lastApiMinute;

    if (apiMinuteWentBackward) {
      this.currentSeconds = apiStart;
      this.lastTickMs = Date.now();
      this.lastApiMinute = apiMinute;
      return;
    }

    if (apiMinuteAdvanced && this.currentSeconds < apiStart) {
      this.currentSeconds = apiStart;
      this.lastTickMs = Date.now();
      this.lastApiMinute = apiMinute;
      return;
    }

    if (
      apiMinute >= baseMinute &&
      this.currentSeconds >= baseMinute * 60 &&
      (period === 1 || period === 2 || period === 3 || period === 4)
    ) {
      this.addedTimeActive = true;
      this.setAddedTimeBadge(officialAdded, this.getFallbackAddedBadge(period), 0);
      this.lastApiMinute = apiMinute;
      return;
    }

    if (this.currentSeconds < apiStart - 5 || this.currentSeconds > apiEnd + 5) {
      this.currentSeconds = apiStart;
      this.lastTickMs = Date.now();
    }

    this.lastApiMinute = apiMinute;
  }

  syncAddedTime(parsed, officialAdded, period) {
    const baseMinute = parsed.baseMinute || this.getPeriodBaseMinute(period);
    const baseSeconds = baseMinute * 60;
    const fallbackBadge = this.getFallbackAddedBadge(period);

    this.addedTimeActive = true;
    this.setAddedTimeBadge(officialAdded, fallbackBadge, parsed.addedMinuteFromApi);

    if (this.currentSeconds < baseSeconds) {
      this.currentSeconds = baseSeconds + Math.max(0, parsed.addedMinuteFromApi - 1) * 60;
      this.lastTickMs = Date.now();
    }

    this.lastApiMinute = baseMinute;
  }

  findOfficialAddedTime(competition, period) {
    const baseMinute = this.getPeriodBaseMinute(period);

    // FIRST: Check status.displayClock (primary source from ESPN API)
    // Format examples: "45'+5'", "90'+8'", "105'+3'"
    const statusClock = competition?.status?.displayClock || "";
    const baseMinuteStr = String(baseMinute);
    if (statusClock.includes(baseMinuteStr)) {
      const plusMatch = statusClock.match(/\+(\d+)/);
      if (plusMatch) {
        return Number(plusMatch[1]);
      }
    }

    // FALLBACK: Check details array (legacy/additional info)
    const details = competition?.details || [];

    for (let i = details.length - 1; i >= 0; i--) {
      const detail = details[i];

      const text = [
        detail?.text,
        detail?.shortText,
        detail?.displayValue,
        detail?.type?.text,
        detail?.type?.description
      ].filter(Boolean).join(" ").toLowerCase();

      const clockText = String(detail?.clock?.displayValue || detail?.displayClock || "");

      const looksLikeAdded =
        text.includes("stoppage") ||
        text.includes("added time") ||
        text.includes("additional time") ||
        text.includes("injury time");

      if (!looksLikeAdded) continue;

      const nearPeriod = clockText.includes(String(baseMinute)) || text.includes(String(baseMinute)) || !clockText;
      if (!nearPeriod) continue;

      const plusMatch = text.match(/\+(\d+)/);
      if (plusMatch) return Number(plusMatch[1]);

      const minuteMatch = text.match(/(\d+)\s*(minute|minutes|min)/);
      if (minuteMatch) return Number(minuteMatch[1]);
    }

    return null;
  }

  tick() {
    if (!this.running) return;
    if (this.state === MatchState.PRE_MATCH) return;
    if (this.state === MatchState.HALF_TIME) return;
    if (this.state === MatchState.FULL_TIME) return;
    if (this.lastTickMs === null) return;

    const now = Date.now();
    const elapsed = Math.floor((now - this.lastTickMs) / 1000);
    if (elapsed <= 0) return;

    this.lastTickMs += elapsed * 1000;

    const period = this.lastPeriod || 2;
    const baseMinute = this.getPeriodBaseMinute(period);
    const baseSeconds = baseMinute * 60;

    if (
      this.currentSeconds >= baseSeconds &&
      (period === 1 || period === 2 || period === 3 || period === 4)
    ) {
      this.addedTimeActive = true;
      this.setAddedTimeBadge(null, this.getFallbackAddedBadge(period), 0);
    }

    this.currentSeconds += elapsed;
    this.render();
  }

  render() {
    if (!this.clockEl) return;

    const period = this.lastPeriod || 2;
    const baseMinute = this.getPeriodBaseMinute(period);
    const baseSeconds = baseMinute * 60;

    if (this.addedTimeActive && this.currentSeconds >= baseSeconds) {
      const addedSeconds = Math.max(0, this.currentSeconds - baseSeconds);
      const addedMinutes = Math.floor(addedSeconds / 60);
      const addedRemainderSeconds = addedSeconds % 60;

      this.clockEl.classList.remove("state-text");
      this.clockEl.innerText = `${String(baseMinute).padStart(2, "0")}:00`;

      if (this.stoppageIncrementEl) {
        this.stoppageIncrementEl.innerText = `+${this.addedTimeBadgeMinutes}`;
      }

      if (this.stoppageClockEl) {
        this.stoppageClockEl.innerText = `${addedMinutes}:${String(addedRemainderSeconds).padStart(2, "0")}`;
      }

      this.stoppageModuleEl?.classList.add("show-stoppage");
      this.stoppageModuleEl?.classList.add("added-time-active");
      return;
    }

    const minutes = Math.floor(this.currentSeconds / 60);
    const seconds = this.currentSeconds % 60;

    this.clockEl.classList.remove("state-text");
    this.clockEl.innerText = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    this.stoppageModuleEl?.classList.remove("show-stoppage");
    this.stoppageModuleEl?.classList.remove("added-time-active");
  }

  stopAtStateText(label, seconds) {
    this.running = false;
    this.currentSeconds = seconds;
    this.lastTickMs = null;
    this.lastApiMinute = null;
    this.addedTimeActive = false;
    this.addedTimeBadgeMinutes = 0;
    this.addedTimeBadgeSource = null;
    this.state = label === "FT" ? MatchState.FULL_TIME : this.state;

    this.stoppageModuleEl?.classList.remove("show-stoppage");
    this.stoppageModuleEl?.classList.remove("added-time-active");

    if (this.clockEl) {
      this.clockEl.classList.add("state-text");
      this.clockEl.innerText = label;
    }
  }

  resetPeriodState() {
    this.lastApiMinute = null;
    this.lastTickMs = null;
    this.addedTimeActive = false;
    this.addedTimeBadgeMinutes = 0;
    this.addedTimeBadgeSource = null;
  }
}

/* =========================
   GOALS
========================= */

class GoalEventManager {
  constructor({ apiUrl, homeTeam, awayTeam, onGoalConfirmed }) {
    this.apiUrl = apiUrl;
    this.homeTeam = homeTeam;
    this.awayTeam = awayTeam;
    this.onGoalConfirmed = onGoalConfirmed;
    this.lastHomeScore = null;
    this.lastAwayScore = null;
    this.highWaterHomeScore = 0;
    this.highWaterAwayScore = 0;
    this.pendingGoals = new Map();
  }

  updateFromCompetition({ homeCompetitor, awayCompetitor }) {
    const homeScore = parseScore(homeCompetitor?.score);
    const awayScore = parseScore(awayCompetitor?.score);

    if (homeScore === null || awayScore === null) return { accepted: false };

    if (this.lastHomeScore === null || this.lastAwayScore === null) {
      this.commitScores(homeScore, awayScore);
      return { accepted: true, initialized: true };
    }

    const homeRolledBack = this.lastHomeScore !== null && homeScore < this.lastHomeScore;
    const awayRolledBack = this.lastAwayScore !== null && awayScore < this.lastAwayScore;

    if (homeRolledBack || awayRolledBack) {
      this.commitScores(homeScore, awayScore);
      return { accepted: true, rollback: true };
    }

    if (homeScore > this.lastHomeScore) {
      this.queueGoal({
        teamAbbr: this.homeTeam,
        fullTeamName: homeCompetitor?.team?.displayName || this.homeTeam,
        expectedGoalCount: homeScore,
        scoreBoxId: "home-score"
      });
    }

    if (awayScore > this.lastAwayScore) {
      this.queueGoal({
        teamAbbr: this.awayTeam,
        fullTeamName: awayCompetitor?.team?.displayName || this.awayTeam,
        expectedGoalCount: awayScore,
        scoreBoxId: "away-score"
      });
    }

    this.commitScores(homeScore, awayScore);
    return { accepted: true };
  }

  commitScores(homeScore, awayScore) {
    this.lastHomeScore = homeScore;
    this.lastAwayScore = awayScore;
    this.highWaterHomeScore = Math.max(this.highWaterHomeScore, homeScore);
    this.highWaterAwayScore = Math.max(this.highWaterAwayScore, awayScore);
  }

  queueGoal({ teamAbbr, fullTeamName, expectedGoalCount, scoreBoxId }) {
    const key = `${teamAbbr}_${expectedGoalCount}`;
    if (this.pendingGoals.has(key)) return;

    this.pendingGoals.set(key, {
      teamAbbr,
      fullTeamName,
      expectedGoalCount,
      scoreBoxId,
      startedAt: Date.now()
    });

    this.retryGoalLookup(key);
  }

  async retryGoalLookup(key) {
    const pending = this.pendingGoals.get(key);
    if (!pending) return;

    const elapsed = Date.now() - pending.startedAt;

    try {
      const response = await fetch(this.apiUrl);
      const data = await response.json();
      const match = findConfiguredMatch(data);
      const competition = match?.competitions?.[0];

      const scorer = competition
        ? this.findLatestScorer(competition, pending.teamAbbr, pending.expectedGoalCount)
        : null;

      if (scorer) {
        this.pendingGoals.delete(key);
        this.onGoalConfirmed({
          teamAbbr: pending.teamAbbr,
          fullTeamName: pending.fullTeamName,
          scoreBoxId: pending.scoreBoxId,
          scorer
        });
        return;
      }
    } catch {}

    if (elapsed >= 45000) {
      this.pendingGoals.delete(key);
      this.onGoalConfirmed({
        teamAbbr: pending.teamAbbr,
        fullTeamName: pending.fullTeamName,
        scoreBoxId: pending.scoreBoxId,
        scorer: { name: pending.fullTeamName, id: null, headshot: null }
      });
      return;
    }

    setTimeout(() => this.retryGoalLookup(key), 2000);
  }

  findLatestScorer(competition, teamAbbr, expectedGoalCount) {
    const goals = this.extractGoalEvents(competition)
      .filter(event => event.teamAbbr === teamAbbr)
      .sort((a, b) => a.sequence - b.sequence);

    if (goals.length < expectedGoalCount) return null;
    return goals[expectedGoalCount - 1]?.scorer || null;
  }

  extractGoalEvents(competition) {
    const events = [];

    const push = (item, index, source) => {
      const text = String(
        item?.type?.text ||
        item?.type?.abbreviation ||
        item?.type?.name ||
        item?.text ||
        ""
      ).toLowerCase();

      const isGoal = text.includes("goal") || text.includes("penalty - scored") || text === "g";
      if (!isGoal) return;

      const teamAbbr = normalizeTeamCode(item?.team?.abbreviation || item?.team?.abbrev || "");
      if (!teamAbbr) return;

      // Extract athlete from multiple possible locations
      const athlete = 
        item?.athletesInvolved?.[0] || 
        item?.participants?.[0]?.athlete || 
        item?.athlete ||
        item?.scoringPlayer;

      // Try multiple name fields
      let scorerName = null;
      if (athlete) {
        scorerName = 
          athlete.displayName || 
          athlete.fullName || 
          athlete.shortName ||
          athlete.name ||
          athlete.firstName && athlete.lastName ? `${athlete.firstName} ${athlete.lastName}` : null;
      }

      // Also check if the goal description contains a player name
      if (!scorerName && item?.description) {
        const descMatch = item.description.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
        if (descMatch) scorerName = descMatch[1];
      }

      events.push({
        source,
        teamAbbr,
        sequence: Number(item?.sequenceNumber || item?.sequence || item?.id || index),
        scorer: {
          name: scorerName,
          id: athlete?.id || null,
          headshot: athlete?.headshot?.href || athlete?.headshot || null
        }
      });
    };

    (competition?.details || []).forEach((item, index) => push(item, index, "details"));
    (competition?.scoringPlays || []).forEach((item, index) => push(item, index + 10000, "scoringPlays"));

    return events;
  }
}

/* =========================
   RED CARDS
========================= */

class RedCardTracker {
  constructor({ homeTeam, awayTeam }) {
    this.homeTeam = normalizeTeamCode(homeTeam);
    this.awayTeam = normalizeTeamCode(awayTeam);
    this.lastCounts = {
      [this.homeTeam]: 0,
      [this.awayTeam]: 0
    };
    this.initialized = false;
  }

  update(competition, homeCompetitor, awayCompetitor) {
    const homeCount = this.countRedCards(competition, homeCompetitor, this.homeTeam);
    const awayCount = this.countRedCards(competition, awayCompetitor, this.awayTeam);

    this.updateCountEl("home-reds", homeCount);
    this.updateCountEl("away-reds", awayCount);

    if (this.initialized && homeCount > this.lastCounts[this.homeTeam]) {
      this.showRedCardGraphic(this.homeTeam, homeCount);
    }

    if (this.initialized && awayCount > this.lastCounts[this.awayTeam]) {
      this.showRedCardGraphic(this.awayTeam, awayCount);
    }

    this.lastCounts[this.homeTeam] = Math.max(this.lastCounts[this.homeTeam], homeCount);
    this.lastCounts[this.awayTeam] = Math.max(this.lastCounts[this.awayTeam], awayCount);
    this.initialized = true;
  }

  countRedCards(competition, competitor, teamAbbr) {
    const fromDetails = this.countFromDetails(competition, competitor, teamAbbr);
    const fromStats = this.countFromCompetitorStats(competitor);
    return Math.max(fromDetails, fromStats);
  }

  countFromDetails(competition, competitor, teamAbbr) {
    const details = competition?.details || [];
    const teamId = String(competitor?.team?.id || "");
    const teamNames = [
      teamAbbr,
      competitor?.team?.abbreviation,
      competitor?.team?.shortDisplayName,
      competitor?.team?.displayName,
      competitor?.team?.name
    ].filter(Boolean).map(v => String(v).toLowerCase());

    return details.filter(detail => {
      const detailTeamAbbr = normalizeTeamCode(detail?.team?.abbreviation || detail?.team?.abbrev || "");
      const detailTeamId = String(detail?.team?.id || "");

      const text = [
        detail?.type?.text,
        detail?.type?.abbreviation,
        detail?.type?.name,
        detail?.text,
        detail?.shortText,
        detail?.displayValue,
        detail?.description
      ].filter(Boolean).join(" ").toLowerCase();

      const isRed =
        text.includes("red card") ||
        text.includes("second yellow") ||
        text.includes("sent off") ||
        text.includes("dismissed") ||
        text === "rc" ||
        text.includes(" rc");

      if (!isRed) return false;

      return (
        detailTeamAbbr === teamAbbr ||
        Boolean(teamId && detailTeamId && teamId === detailTeamId) ||
        teamNames.some(name => text.includes(name))
      );
    }).length;
  }

  countFromCompetitorStats(competitor) {
    const stats = [
      ...(competitor?.statistics || []),
      ...(competitor?.stats || [])
    ];

    let max = 0;

    for (const stat of stats) {
      const name = [
        stat?.name,
        stat?.displayName,
        stat?.shortDisplayName,
        stat?.abbreviation,
        stat?.label
      ].filter(Boolean).join(" ").toLowerCase();

      const isRedStat =
        name.includes("red card") ||
        name.includes("red cards") ||
        name === "rc" ||
        name.includes("discipline red");

      if (!isRedStat) continue;

      const value = Number(stat?.value ?? stat?.displayValue ?? stat?.summary ?? 0);
      if (Number.isFinite(value)) max = Math.max(max, value);
    }

    return max;
  }

  updateCountEl(elementId, count) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (count > 0) {
      el.innerText = String(count);
      el.style.display = "flex";
    } else {
      el.style.display = "none";
    }
  }

  showRedCardGraphic(teamAbbr, count) {
    let banner = document.getElementById("red-card-banner");

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "red-card-banner";
      banner.innerHTML = `
        <div class="red-card-graphic">
          <div class="red-card-shape"></div>
          <div>
            <div class="red-card-title">RED CARD</div>
            <div class="red-card-team"></div>
          </div>
        </div>
      `;
      document.body.appendChild(banner);

      const style = document.createElement("style");
      style.textContent = `
        #red-card-banner {
          position: fixed;
          left: 50%;
          top: 16%;
          transform: translate(-50%, -30px);
          z-index: 99999;
          opacity: 0;
          pointer-events: none;
          transition: opacity .25s ease, transform .25s ease;
        }
        #red-card-banner.show {
          opacity: 1;
          transform: translate(-50%, 0);
        }
        .red-card-graphic {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 18px;
          background: rgba(10, 10, 12, .94);
          border: 1px solid rgba(255, 255, 255, .22);
          box-shadow: 0 18px 50px rgba(0,0,0,.45);
          color: #fff;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .red-card-shape {
          width: 42px;
          height: 58px;
          background: linear-gradient(160deg, #ff1f3d, #9b0015);
          border-radius: 4px;
          box-shadow: 0 0 22px rgba(255, 31, 61, .75);
          animation: redCardPop .8s ease both;
        }
        .red-card-title {
          font-size: 18px;
          font-weight: 900;
        }
        .red-card-team {
          margin-top: 2px;
          font-size: 13px;
          font-weight: 700;
          opacity: .78;
        }
        @keyframes redCardPop {
          0% { transform: scale(.6) rotate(-12deg); }
          60% { transform: scale(1.08) rotate(4deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `;
      document.head.appendChild(style);
    }

    const teamEl = banner.querySelector(".red-card-team");
    if (teamEl) teamEl.textContent = `${teamAbbr} ${count > 1 ? `(${count})` : ""}`;

    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");

    setTimeout(() => banner.classList.remove("show"), 5000);
  }
}

/* =========================
   UI EFFECTS
========================= */

function triggerGoalAlert(teamAbbr, teamFullName, scorerName, imageUrl, fallbackImageUrls = []) {
  const banner = document.getElementById("alert-banner");
  const imageEl = document.getElementById("alert-team-flag");
  const scorerNameEl = document.getElementById("alert-scorer-name");
  const scorerTeamEl = document.getElementById("alert-scorer-team");

  if (!banner || !imageEl || !scorerNameEl || !scorerTeamEl) return;

  safeLoadImage(imageEl, imageUrl, fallbackImageUrls);

  imageEl.alt = scorerName || "Scorer";
  scorerNameEl.innerText = String(scorerName || teamFullName || "GOAL").toUpperCase();
  scorerTeamEl.innerText = String(teamFullName || teamAbbr || "").toUpperCase();

  pendingGoalTimeouts.forEach(clearTimeout);
  pendingGoalTimeouts = [];

  banner.classList.remove("slide-down");
  void banner.offsetWidth;
  banner.classList.add("slide-down");

  pendingGoalTimeouts.push(setTimeout(() => {
    banner.classList.remove("slide-down");
  }, 12000));
}

function spawnScoreBurst(scoreBoxId) {
  const scoreBox = document.getElementById(scoreBoxId);
  const wrapper = document.querySelector(".main-layout-wrapper");
  const emitter = document.getElementById("particle-emitter");

  if (!scoreBox || !wrapper || !emitter) return;

  const rect = scoreBox.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2 - wrapperRect.left;
  const centerY = rect.top + rect.height / 2 - wrapperRect.top;
  const colors = ["#ff4b60", "#8a3ffc", "#00f0c5", "#a6ff00", "#ffd700", "#ffffff"];

  for (let i = 0; i < 50; i++) {
    const particle = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = Math.floor(Math.random() * 8) + 6;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.floor(Math.random() * 150) + 50;
    const duration = (Math.random() * 0.8 + 0.6).toFixed(2);

    particle.className = "particle";
    particle.style.backgroundColor = color;
    particle.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${centerX}px`;
    particle.style.top = `${centerY}px`;
    particle.style.setProperty("--x", "0px");
    particle.style.setProperty("--y", "0px");
    particle.style.setProperty("--mx", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--my", `${Math.sin(angle) * distance - Math.random() * 40}px`);
    particle.style.setProperty("--rot", `${Math.floor(Math.random() * 360) + 360}deg`);
    particle.style.animation = `particle-fade-out ${duration}s cubic-bezier(0.1, 0.8, 0.3, 1) forwards`;

    emitter.appendChild(particle);
    setTimeout(() => particle.remove(), Number(duration) * 1000);
  }
}


/* =========================
   MATCH HELPERS
========================= */

function findConfiguredMatch(data) {
  return data?.events?.find(event => {
    const competitors = event?.competitions?.[0]?.competitors || [];
    return (
      competitors.some(c => normalizeTeamCode(c?.team?.abbreviation) === ESPN_HOME_TEAM) &&
      competitors.some(c => normalizeTeamCode(c?.team?.abbreviation) === ESPN_AWAY_TEAM)
    );
  });
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.innerText = value;
}

/* =========================
   BOOTSTRAP
========================= */

document.addEventListener("DOMContentLoaded", () => {
  setText(".home-team .team-name", HOME_TEAM);
  setText(".away-team .team-name", AWAY_TEAM);

  safeLoadImage(
    document.querySelector(".home-team .team-flag"),
    `https://a.espncdn.com/i/teamlogos/countries/500/${ESPN_HOME_TEAM.toLowerCase()}.png`,
    [getFallbackFlag(ESPN_HOME_TEAM)]
  );

  safeLoadImage(
    document.querySelector(".away-team .team-flag"),
    `https://a.espncdn.com/i/teamlogos/countries/500/${ESPN_AWAY_TEAM.toLowerCase()}.png`,
    [getFallbackFlag(ESPN_AWAY_TEAM)]
  );

  matchTimer = new MatchTimer({
    clockEl: document.getElementById("clock"),
    stoppageModuleEl: document.getElementById("stoppage-module"),
    stoppageClockEl: document.getElementById("stoppage-clock"),
    stoppageIncrementEl: document.getElementById("stoppage-increment")
  });

  goalEventManager = new GoalEventManager({
    apiUrl: API_URL,
    homeTeam: ESPN_HOME_TEAM,
    awayTeam: ESPN_AWAY_TEAM,
    onGoalConfirmed({ teamAbbr, fullTeamName, scoreBoxId, scorer }) {
      const imageCandidates = buildScorerImageCandidates({
        athleteId: scorer.id,
        espnHeadshot: scorer.headshot,
        scorerName: scorer.name,
        teamAbbr
      });

      triggerGoalAlert(teamAbbr, fullTeamName, scorer.name, imageCandidates[0], imageCandidates.slice(1));
      spawnScoreBurst(scoreBoxId);

      const scoreEl = document.getElementById(scoreBoxId);
      if (scoreEl) {
        scoreEl.classList.add("flash");
        setTimeout(() => scoreEl.classList.remove("flash"), 3000);
      }
    }
  });

  redCardTracker = new RedCardTracker({
    homeTeam: ESPN_HOME_TEAM,
    awayTeam: ESPN_AWAY_TEAM
  });


  if (!window.__WC_DEMO_MODE__) {
    fetchMatchData();
    livePollIntervalId = setInterval(fetchMatchData, POLL_INTERVAL_MS);
  }

  startPageVersionPolling();
});

async function checkPageVersion() {
  try {
    const cacheBuster = Date.now();
    const response = await fetch(`${PAGE_VERSION_URL}?cb=${cacheBuster}`, { cache: "no-store" });
    if (!response.ok) return;

    const currentVersion = (await response.text()).trim();
    if (!currentVersion) return;

    if (knownPageVersion === null) {
      knownPageVersion = currentVersion;
      return;
    }

    if (currentVersion !== knownPageVersion) {
      knownPageVersion = currentVersion;
      location.reload();
    }
  } catch (error) {
    console.warn("[scoreboard] page version check failed", error);
  }
}

function startPageVersionPolling() {
  checkPageVersion();
  setInterval(checkPageVersion, PAGE_VERSION_POLL_MS);
}

/* =========================
   MAIN FETCH LOOP
========================= */

async function fetchMatchData() {
  if (window.__WC_DEMO_MODE__) return;

  try {
    const response = await fetch(API_URL);
    const data = await response.json();

    const match = findConfiguredMatch(data);

    if (!match) {
      console.warn(`[scoreboard] No ESPN match found for ${HOME_TEAM}/${AWAY_TEAM}. Using ${ESPN_HOME_TEAM}/${ESPN_AWAY_TEAM}.`);
      return;
    }

    const competition = match.competitions?.[0];
    if (!competition) return;

    const homeCompetitor = competition.competitors.find(c => normalizeTeamCode(c?.team?.abbreviation) === ESPN_HOME_TEAM);
    const awayCompetitor = competition.competitors.find(c => normalizeTeamCode(c?.team?.abbreviation) === ESPN_AWAY_TEAM);

    if (!homeCompetitor || !awayCompetitor) return;

    setText(".home-team .team-name", HOME_TEAM);
    setText(".away-team .team-name", AWAY_TEAM);
    applyTeamStatusDotColors(homeCompetitor, awayCompetitor);

    const scoreResult = goalEventManager.updateFromCompetition({
      homeCompetitor,
      awayCompetitor
    });

    if (scoreResult.accepted) {
      const homeScore = parseScore(homeCompetitor.score);
      const awayScore = parseScore(awayCompetitor.score);

      if (homeScore !== null) document.getElementById("home-score").innerText = String(homeScore);
      if (awayScore !== null) document.getElementById("away-score").innerText = String(awayScore);
    }

    matchTimer.updateFromApi(match, competition);
    redCardTracker.update(competition, homeCompetitor, awayCompetitor);

    safeLoadImage(
      document.querySelector(".home-team .team-flag"),
      homeCompetitor.team?.logo || `https://a.espncdn.com/i/teamlogos/countries/500/${ESPN_HOME_TEAM.toLowerCase()}.png`,
      [getFallbackFlag(ESPN_HOME_TEAM)]
    );

    safeLoadImage(
      document.querySelector(".away-team .team-flag"),
      awayCompetitor.team?.logo || `https://a.espncdn.com/i/teamlogos/countries/500/${ESPN_AWAY_TEAM.toLowerCase()}.png`,
      [getFallbackFlag(ESPN_AWAY_TEAM)]
    );
  } catch (error) {
    console.error("Error updating live tracking systems:", error);
  }
}