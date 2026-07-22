import type { Meeting, MomReport } from "./types";

// Builds a fully styled, self-contained HTML document mirroring the reference
// "Engagement Report" MOM design. Uses momReport data when available and
// falls back to the raw summary / chapters / actionItems for older sessions.
export function buildMomHtml(meeting: Meeting): string {
  const title =
    meeting.meetingName?.trim() ||
    (meeting.summary?.trim() || meeting.sessionId).split(/[.!?]/)[0].trim();

  const durationSeconds = computeDuration(meeting);
  const dateLabel = formatLongDate(meeting.startedAt ?? meeting.createdAt);
  const isoDate = isoDateLabel(meeting.startedAt ?? meeting.createdAt);
  const report = meeting.momReport ?? buildLocalFallback(meeting);

  const stats = [
    { label: "Date", value: formatDateValue(meeting.startedAt ?? meeting.createdAt), delta: formatWeekdayValue(meeting.startedAt ?? meeting.createdAt) },
    { label: "Duration", value: formatDurationValue(durationSeconds), delta: "Recorded session" },
    { label: "Attendees", value: pad2(meeting.participants.length), delta: meeting.participants.length === 1 ? "1 participant" : `${meeting.participants.length} participants` },
    { label: "Sentiment", value: `${report.toneBreakdown.positive}<sub>%</sub>`, delta: "Positive tone share", accent: "accent-green" },
    { label: "Actions", value: pad2(report.actionItems.length || meeting.actionItems.length), delta: ownerSplit(report) ?? "Captured this session", accent: "accent-claret" }
  ];

  const sections: string[] = [];
  sections.push(renderExecutive(report));
  sections.push(renderSentiment(report));
  sections.push(renderUpsDowns(report));
  sections.push(renderMom(meeting, report));
  sections.push(renderActions(report));
  sections.push(renderTodos(report));
  sections.push(renderRisks(report));
  sections.push(renderNextSteps(report));
  sections.push(renderAttendees(meeting, report));

  const tocLinks = TOC_ITEMS.map(
    (item) => `<a href="#${item.id}"><span class="n">${item.n}</span> ${escapeHtml(item.label)}</a>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)} · Minutes of Meeting${dateLabel ? ` · ${escapeHtml(dateLabel)}` : ""}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:opsz,wght,SOFT@9..144,400;9..144,500;9..144,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${MOM_CSS}</style>
<script>
(function(){try{var k='gv-mom-theme';var s=localStorage.getItem(k);var t=(s==='dark'||s==='light')?s:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
</script>
</head>
<body>
<div class="page">
  <nav class="toc" aria-label="Table of contents">
    <div class="toc-inner">${tocLinks}</div>
  </nav>

  <div class="topbar reveal">
    <div class="brand">
      <div class="mark">G</div>
      gVoice · Engagement Report
    </div>
    <div class="right">
      <span class="pill live">● ${escapeHtml(meeting.status.replace(/_/g, " "))}</span>
      <span class="pill">MOM · ${escapeHtml(isoDate)}</span>
      <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode" title="Toggle light / dark theme">
        <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.1" y1="5.1" x2="6.8" y2="6.8"/><line x1="17.2" y1="17.2" x2="18.9" y2="18.9"/><line x1="5.1" y1="18.9" x2="6.8" y2="17.2"/><line x1="17.2" y1="6.8" x2="18.9" y2="5.1"/></svg>
        <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
    </div>
  </div>

  <section class="hero">
    <div class="hero-eyebrow reveal d1">${escapeHtml(platformLabel(meeting.platform))} call · Minutes of Meeting</div>
    <h1 class="reveal d1">${heroTitle(title)}</h1>

    <div class="stats reveal d3">
      ${stats
        .map(
          (stat) => `<div class="stat${stat.accent ? ` ${stat.accent}` : ""}">
        <div class="label">${escapeHtml(stat.label)}</div>
        <div class="value">${stat.value}</div>
        <div class="delta">${escapeHtml(stat.delta)}</div>
      </div>`
        )
        .join("\n      ")}
    </div>
  </section>

  ${sections.join("\n  ")}

  <footer>
    <div>Prepared by <strong>gVoice</strong> · ${escapeHtml(dateLabel || "Generated")}</div>
    <div class="right">
      <span>MOM-${escapeHtml(meeting.sessionId.slice(0, 8))}</span>
      <span style="color:var(--line-2)">·</span>
      <span>Confidential</span>
    </div>
  </footer>
</div>

<script>
(function () {
  // Scroll-position scrollspy. An IntersectionObserver "active band" can never
  // highlight the LAST section (it sits below the band when the page bottoms
  // out), so we compute the active link from scroll position and explicitly
  // activate the final link once the page is scrolled to the bottom. Clicks
  // win immediately and lock out the scroll handler briefly so the smooth
  // scroll can't flicker the highlight.
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (!links.length) return;
  var items = links
    .map(function (a) { return { a: a, el: document.getElementById(a.getAttribute('href').slice(1)) }; })
    .filter(function (e) { return e.el; });
  if (!items.length) return;
  var lockUntil = 0;
  function setActive(a) {
    links.forEach(function (l) { l.classList.toggle('active', l === a); });
    var inner = a.parentElement;
    if (inner && inner.scrollWidth > inner.clientWidth + 1) {
      var ir = inner.getBoundingClientRect();
      var ar = a.getBoundingClientRect();
      inner.scrollLeft += (ar.left - ir.left) - (inner.clientWidth - a.offsetWidth) / 2;
    }
  }
  function update() {
    if (Date.now() < lockUntil) return;
    var doc = document.documentElement;
    var line = window.innerHeight * 0.35;
    var atBottom = (window.innerHeight + window.scrollY) >= (doc.scrollHeight - 4);
    var current = items[0];
    if (atBottom) {
      current = items[items.length - 1];
    } else {
      items.forEach(function (e) { if (e.el.getBoundingClientRect().top <= line) current = e; });
    }
    setActive(current.a);
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; update(); });
  }, { passive: true });
  links.forEach(function (a) {
    a.addEventListener('click', function () { setActive(a); lockUntil = Date.now() + 900; });
  });
  update();
})();

(function () {
  const KEY = 'gv-mom-theme';
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
  });
})();
</script>
</body>
</html>`;
}

const TOC_ITEMS = [
  { id: "summary", n: "01", label: "Summary" },
  { id: "sentiment", n: "02", label: "Sentiment" },
  { id: "ud", n: "03", label: "Ups & Downs" },
  { id: "mom", n: "04", label: "Minutes" },
  { id: "actions", n: "05", label: "Actions" },
  { id: "todos", n: "06", label: "To-dos" },
  { id: "risks", n: "07", label: "Risks" },
  { id: "next", n: "08", label: "Next Steps" },
  { id: "attendees", n: "09", label: "Attendees" }
];

function renderExecutive(report: MomReport): string {
  return `<section id="summary">
    <div class="sec-head">
      <div class="sec-num">01</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Executive <span class="ital">summary</span></h2>
        <div class="sec-sub">Two-minute read. What happened, what was decided, what comes next.</div>
      </div>
    </div>
    <div class="exec reveal">
      <p>${renderRichText(report.executiveSummary) || "<em>No summary available.</em>"}</p>
    </div>
  </section>`;
}

function renderSentiment(report: MomReport): string {
  const tone = report.toneBreakdown;
  const bars = [
    { kind: "pos", label: "Positive", pct: tone.positive, note: "Wins, decisions and alignment moments." },
    { kind: "neu", label: "Neutral", pct: tone.neutral, note: "Walkthroughs, demos, factual exchanges." },
    { kind: "neg", label: "Concerns", pct: tone.concerns, note: "Pushback, blockers, friction." }
  ];

  const quotes = report.notableQuotes;
  const quotesHtml = quotes.length
    ? quotes
        .map(
          (q) => `<div class="quote">
            <div class="q">${escapeHtml(q.text)}</div>
            <div class="who"><span class="av" style="background:${avatarColor(q.speaker)};color:#FFFFFF">${escapeHtml(initials(q.speaker))}</span><strong>${escapeHtml(q.speaker || "—")}</strong>${q.company ? ` · ${escapeHtml(q.company)}` : ""}</div>
          </div>`
        )
        .join("\n")
    : `<div class="quote"><div class="q" style="font-style:normal;color:var(--muted)">No standout quotes captured.</div></div>`;

  return `<section id="sentiment">
    <div class="sec-head">
      <div class="sec-num">02</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Sentiment <span class="ital">analysis</span></h2>
        <div class="sec-sub">Tone distribution across the session, plus the quotes that defined the room.</div>
      </div>
    </div>

    <div class="sentiment-grid">
      <div class="sent-card reveal">
        <div class="sent-head">Tone distribution</div>
        ${bars
          .map(
            (bar) => `<div class="sent-bar ${bar.kind}">
          <div class="row1"><div class="name"><span class="dot"></span> ${escapeHtml(bar.label)}</div><div class="pct">${bar.pct}%</div></div>
          <div class="track"><div class="fill" style="width:${bar.pct}%"></div></div>
          <div class="note">${escapeHtml(bar.note)}</div>
        </div>`
          )
          .join("\n        ")}
      </div>
      <div class="quotes-card reveal d1">
        <div class="sent-head">Notable quotes</div>
        <div class="quotes-scroll">
          ${quotesHtml}
        </div>
      </div>
    </div>
  </section>`;
}

function renderUpsDowns(report: MomReport): string {
  const upsHtml = report.positives.length
    ? report.positives
        .map(
          (p) => `<li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span><strong>${escapeHtml(p.title)}</strong>${p.detail ? escapeHtml(p.detail) : ""}</span></li>`
        )
        .join("\n")
    : `<li><span style="color:var(--muted)">No positives captured.</span></li>`;
  const downsHtml = report.concerns.length
    ? report.concerns
        .map(
          (c) => `<li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5"/></svg></span><span><strong>${escapeHtml(c.title)}</strong>${c.detail ? escapeHtml(c.detail) : ""}</span></li>`
        )
        .join("\n")
    : `<li><span style="color:var(--muted)">No concerns surfaced.</span></li>`;

  return `<section id="ud">
    <div class="sec-head">
      <div class="sec-num">03</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Ups &amp; <span class="ital">downs</span></h2>
        <div class="sec-sub">What landed and what still needs work.</div>
      </div>
    </div>

    <div class="ud">
      <div class="ud-card up reveal">
        <div class="ud-head">
          <div class="ud-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
          <div class="ud-title">Positives &amp; wins</div>
          <div class="ud-count">${pad2(report.positives.length)} items</div>
        </div>
        <ul>${upsHtml}</ul>
      </div>
      <div class="ud-card down reveal d1">
        <div class="ud-head">
          <div class="ud-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
          <div class="ud-title">Concerns &amp; open items</div>
          <div class="ud-count">${pad2(report.concerns.length)} items</div>
        </div>
        <ul>${downsHtml}</ul>
      </div>
    </div>
  </section>`;
}

function renderMom(meeting: Meeting, report: MomReport): string {
  const sections = report.momSections.length
    ? report.momSections
    : (meeting.chapters ?? []).map((chapter, index) => ({
        index,
        tag: "Topic",
        topic: chapter.title,
        body: ""
      }));

  const items = sections.length
    ? sections
        .map((section) => {
          const segment = meeting.diarizedTranscript[section.index];
          const stamp = segment ? formatTimestamp(segment.startTime) : "—";
          return `<div class="mom-item">
        <div class="mom-stamp"><div class="t">${escapeHtml(stamp)}</div><div class="l">${escapeHtml(section.tag || "Topic")}</div></div>
        <div>
          <span class="mom-tag ${tagClass(section.tag)}">${escapeHtml(section.tag || "Topic")}</span>
          <div class="mom-topic">${escapeHtml(section.topic)}</div>
          <div class="mom-body">${renderRichText(section.body)}</div>
        </div>
      </div>`;
        })
        .join("\n      ")
    : `<div class="mom-item"><div class="mom-stamp"><div class="t">—</div><div class="l">No topics</div></div><div><div class="mom-body" style="color:var(--muted)">No topic breakdown was generated.</div></div></div>`;

  return `<section id="mom">
    <div class="sec-head">
      <div class="sec-num">04</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Minutes of <span class="ital">meeting</span></h2>
        <div class="sec-sub">Topic-by-topic walkthrough with original timestamps.</div>
      </div>
    </div>
    <div class="mom-card reveal">${items}</div>
  </section>`;
}

function renderActions(report: MomReport): string {
  if (!report.actionItems.length) {
    return `<section id="actions">
      <div class="sec-head"><div class="sec-num">05</div><div class="sec-titlewrap"><h2 class="sec-title">Action <span class="ital">items</span></h2><div class="sec-sub">Nothing tracked this session.</div></div></div>
      <div class="tbl-card reveal" style="padding:24px 28px;color:var(--muted);font-size:14px">No action items captured.</div>
    </section>`;
  }

  const rows = report.actionItems
    .map((item, index) => {
      const priorityChip = item.priority
        ? `<span class="chip ${item.priority === "high" ? "high" : item.priority === "medium" ? "med" : "low"}">${escapeHtml(item.priority)}</span>`
        : `<span class="chip med">Medium</span>`;
      const statusChip = item.status
        ? `<span class="chip ${item.status === "in_progress" ? "prog" : item.status === "planned" ? "plan" : item.status === "done" ? "low" : "open"}">${escapeHtml(item.status.replace(/_/g, " "))}</span>`
        : `<span class="chip open">Open</span>`;
      return `<tr>
        <td class="idx">${pad2(index + 1)}</td>
        <td class="task"><strong>${escapeHtml(item.task)}</strong>${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}</td>
        <td class="owner">${renderOwners(item.owners ?? (item.owner ? [item.owner] : []))}</td>
        <td class="due">${escapeHtml(item.due ?? "—")}</td>
        <td class="center">${priorityChip}</td>
        <td class="center">${statusChip}</td>
      </tr>`;
    })
    .join("\n");

  return `<section id="actions">
    <div class="sec-head">
      <div class="sec-num">05</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Action <span class="ital">items</span></h2>
        <div class="sec-sub">${report.actionItems.length} item${report.actionItems.length === 1 ? "" : "s"} captured.</div>
      </div>
    </div>
    <div class="tbl-card reveal">
      <div class="tbl-scroll">
        <table>
          <thead><tr><th>#</th><th>Task</th><th>Owner</th><th>Due</th><th class="center">Priority</th><th class="center">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </section>`;
}

function renderTodos(report: MomReport): string {
  if (!report.topTodos.length) {
    return `<section id="todos">
      <div class="sec-head"><div class="sec-num">06</div><div class="sec-titlewrap"><h2 class="sec-title">Top <span class="ital">to-dos</span></h2><div class="sec-sub">No to-dos surfaced.</div></div></div>
    </section>`;
  }
  const cards = report.topTodos
    .map(
      (todo, i) => `<div class="todo reveal${i % 4 === 1 ? " d1" : i % 4 === 2 ? " d2" : i % 4 === 3 ? " d3" : ""}">
      <div class="top"><div class="n">${pad2(i + 1)}</div><div class="pri">${escapeHtml(todo.priority ?? "Medium")}</div></div>
      <div class="t">${escapeHtml(todo.title)}</div>
      <div class="d">${escapeHtml(todo.detail)}</div>
      <div class="meta">${todo.owner ? `<span class="av" style="background:${avatarColor(todo.owner)}">${escapeHtml(initials(todo.owner))}</span> ${escapeHtml(todo.owner)}` : ""}${todo.due ? ` <span class="due">${escapeHtml(todo.due)}</span>` : ""}</div>
    </div>`
    )
    .join("\n");
  return `<section id="todos">
    <div class="sec-head">
      <div class="sec-num">06</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Top <span class="ital">to-dos</span></h2>
        <div class="sec-sub">The next 48–72 hours, ordered by impact.</div>
      </div>
    </div>
    <div class="todos">${cards}</div>
  </section>`;
}

function renderRisks(report: MomReport): string {
  if (!report.risks.length) {
    return `<section id="risks">
      <div class="sec-head"><div class="sec-num">07</div><div class="sec-titlewrap"><h2 class="sec-title">Risks &amp; <span class="ital">blockers</span></h2><div class="sec-sub">No risks tracked.</div></div></div>
    </section>`;
  }
  const items = report.risks
    .map(
      (risk) => `<div class="risk${risk.severity === "red" ? " blocker" : ""}">
      <div class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
      <div class="body">
        <div class="h"><span class="badge">${risk.severity === "red" ? "Blocker" : "Risk"}</span> ${escapeHtml(risk.title)}</div>
        <div class="d">${escapeHtml(risk.detail)}</div>
      </div>
      <div class="right">Owner<span class="o">${escapeHtml(risk.owner ?? "—")}</span></div>
    </div>`
    )
    .join("\n");
  return `<section id="risks">
    <div class="sec-head">
      <div class="sec-num">07</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Risks &amp; <span class="ital">blockers</span></h2>
        <div class="sec-sub">${(() => { const a = report.risks.filter((r) => r.severity === "amber").length; const b = report.risks.filter((r) => r.severity === "red").length; return `${a} risk${a === 1 ? "" : "s"} · ${b} blocker${b === 1 ? "" : "s"}`; })()}</div>
      </div>
    </div>
    <div class="risks reveal">${items}</div>
  </section>`;
}

function renderNextSteps(report: MomReport): string {
  const steps = report.nextSteps.length
    ? report.nextSteps
    : [{ period: "Next", title: "Continue the work", detail: "Specifics to be defined at the next sync." }];

  // 1-3 milestones → the 3-card hero layout (premium look).
  // 4+ milestones → a clean bullet list so nothing wraps to an orphan row.
  const body = steps.length <= 3
    ? `<div class="steps">${steps
        .map(
          (step, i) => `<div class="step ${i === 0 ? "s1" : i === 1 ? "s2" : "s3"} reveal${i === 1 ? " d1" : i === 2 ? " d2" : ""}">
      <div class="step-num">${pad2(i + 1)}</div>
      <div class="l">${escapeHtml(step.period)}</div>
      <div class="t">${escapeHtml(step.title)}</div>
      <div class="d">${escapeHtml(step.detail)}</div>
    </div>`
        )
        .join("\n")}</div>`
    : `<ol class="steps-list reveal">${steps
        .map(
          (step) => `<li>
          <span class="period">${escapeHtml(step.period)}</span>
          <div class="body"><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.detail)}</span></div>
        </li>`
        )
        .join("\n")}</ol>`;

  return `<section id="next">
    <div class="sec-head">
      <div class="sec-num">08</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">The path <span class="ital">forward</span></h2>
        <div class="sec-sub">${steps.length} milestone${steps.length === 1 ? "" : "s"} ahead.</div>
      </div>
    </div>
    ${body}
  </section>`;
}

function renderAttendees(meeting: Meeting, report: MomReport): string {
  const list = report.attendees.length
    ? report.attendees
    : meeting.participants.map((p) => ({ name: p.name }));
  if (!list.length) {
    return `<section id="attendees">
      <div class="sec-head"><div class="sec-num">09</div><div class="sec-titlewrap"><h2 class="sec-title">Attendees</h2><div class="sec-sub">No attendees captured.</div></div></div>
    </section>`;
  }

  const cards = list
    .map((a, i) => {
      const avc = avatarColor(a.name);
      const delay = i % 5;
      const delayClass = delay === 0 ? "" : ` d${delay}`;
      return `<div class="attendee reveal${delayClass}" style="--avc:${avc}">
      <div class="av-wrap"><div class="av" style="background:${avc}">${escapeHtml(initials(a.name))}</div><span class="presence" aria-hidden="true"></span></div>
      <div class="meta">
        <div class="name">${escapeHtml(a.name)}</div>
      </div>
    </div>`;
    })
    .join("\n");

  return `<section id="attendees">
    <div class="sec-head">
      <div class="sec-num">09</div>
      <div class="sec-titlewrap">
        <h2 class="sec-title">Attendees</h2>
        <div class="sec-sub">${list.length} participant${list.length === 1 ? "" : "s"} on this call.</div>
      </div>
    </div>
    <div class="attendees">${cards}</div>
  </section>`;
}

function buildLocalFallback(meeting: Meeting): MomReport {
  const score = meeting.sentimentSummary?.overall.score ?? 0;
  const positive = Math.round(Math.min(90, Math.max(25, 57.5 + score * 32.5)));
  const concerns = Math.round(Math.min(50, Math.max(5, 15 - score * 15)));
  const neutral = Math.max(0, 100 - positive - concerns);
  return {
    executiveSummary: meeting.summary?.trim() || "No AI summary available for this session.",
    toneBreakdown: { positive, neutral, concerns },
    notableQuotes: (meeting.sentimentSummary?.topMoments ?? [])
      .filter((m) => m.quote)
      .slice(0, 3)
      .map((m) => ({ text: m.quote!, speaker: m.speaker ?? "" })),
    positives: [],
    concerns: [],
    momSections: (meeting.chapters ?? []).map((chapter, index) => ({
      index,
      tag: "Topic",
      topic: chapter.title,
      body: ""
    })),
    actionItems: meeting.actionItems.map((item) => ({
      task: item.task,
      owners: item.assignee ? [item.assignee] : [],
      priority: "medium",
      status: "open"
    })),
    topTodos: [],
    risks: [],
    nextSteps: [],
    attendees: meeting.participants.map((p) => ({ name: p.name, role: p.company })),
    generatedAt: new Date().toISOString(),
    source: "fallback"
  };
}

// ------------------- helpers -------------------

function escapeHtml(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Whitelist <strong> and <em> tags in AI text fields; escape everything else
// so the document stays safe when embedded server text contains stray angle
// brackets.
function renderRichText(value: string | undefined): string {
  if (!value) return "";
  const escaped = escapeHtml(value);
  return escaped
    .replace(/&lt;strong&gt;/g, "<strong>")
    .replace(/&lt;\/strong&gt;/g, "</strong>")
    .replace(/&lt;em&gt;/g, "<em>")
    .replace(/&lt;\/em&gt;/g, "</em>")
    .replace(/\n/g, "<br/>");
}

function heroTitle(title: string): string {
  // Italicise the trailing 1-2 words for a magazine-style look matching the
  // reference design.
  const trimmed = title.trim();
  if (!trimmed) return "<span class=\"ital\">Untitled meeting</span>";
  const words = trimmed.split(/\s+/);
  if (words.length <= 2) return `<span class="ital">${escapeHtml(trimmed)}</span>`;
  const head = words.slice(0, -2).join(" ");
  const tail = words.slice(-2).join(" ");
  return `${escapeHtml(head)} <span class="ital">${escapeHtml(tail)}</span>`;
}

function computeDuration(meeting: Meeting): number {
  if (meeting.startedAt && meeting.endedAt) {
    const start = new Date(meeting.startedAt).getTime();
    const end = new Date(meeting.endedAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return Math.round((end - start) / 1000);
    }
  }
  if (meeting.diarizedTranscript?.length) {
    return Math.max(...meeting.diarizedTranscript.map((s) => s.endTime));
  }
  return 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateValue(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: "short" });
  return `${pad2(day)} <sub>${escapeHtml(month)}</sub>`;
}

function formatWeekdayValue(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday} · ${date.getFullYear()}`;
}

function formatDurationValue(seconds: number): string {
  if (!seconds || seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}<sub>sec</sub>`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}<sub>min</sub>`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining
    ? `${hours}<sub>h</sub> ${pad2(remaining)}<sub>m</sub>`
    : `${hours}<sub>h</sub>`;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function formatLongDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function isoDateLabel(iso?: string): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function platformLabel(platform: Meeting["platform"]): string {
  switch (platform) {
    case "google_meet":
      return "Google Meet";
    case "microsoft_teams":
      return "Microsoft Teams";
    case "zoom":
      return "Zoom";
    case "in_person":
      return "In person";
  }
}

function initials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable deterministic colour per name so the same speaker always gets the
// same avatar tint across all sections of the report.
// Avatar tints. Kept varied (slate / indigo / amber / teal etc.) so individual
// speakers stay visually distinct, but the standout swatches are the brand aqua
// to tie back to the website palette.
const AVATAR_COLORS = [
  "#06b6d4",
  "#2C4D6E",
  "#52407A",
  "#6B4E1F",
  "#7C3A36",
  "#3F3D38",
  "#0e7490",
  "#2B5E5A"
];
function avatarColor(name: string): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Renders an action item's owners: a single avatar + name when one person owns
// it, or an overlapping avatar stack (with name tooltips) when several do.
function renderOwners(owners: string[]): string {
  const clean = owners.map((o) => o.trim()).filter(Boolean);
  if (clean.length === 0) return "—";
  if (clean.length === 1) {
    return `<span class="av" style="background:${avatarColor(clean[0])}">${escapeHtml(initials(clean[0]))}</span>${escapeHtml(clean[0])}`;
  }
  const avatars = clean
    .map(
      (o) =>
        `<span class="av" style="background:${avatarColor(o)}" title="${escapeHtml(o)}">${escapeHtml(initials(o))}</span>`
    )
    .join("");
  return `<span class="av-stack">${avatars}</span><span class="owner-count">${clean.length} owners</span>`;
}

function ownerSplit(report: MomReport): string | undefined {
  if (!report.actionItems.length) return undefined;
  const groups = new Map<string, number>();
  for (const item of report.actionItems) {
    const owners = (item.owners?.length ? item.owners : item.owner ? [item.owner] : [])
      .map((o) => o.trim())
      .filter(Boolean);
    if (owners.length === 0) {
      groups.set("Unassigned", (groups.get("Unassigned") ?? 0) + 1);
      continue;
    }
    for (const owner of owners) {
      groups.set(owner, (groups.get(owner) ?? 0) + 1);
    }
  }
  if (groups.size === 0) return undefined;
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([owner, count]) => `${count} ${owner}`)
    .join(" · ");
}

const TAG_CLASSES = ["t-blue", "t-green", "t-amber", "t-violet", "t-rose", "t-stone"] as const;
function tagClass(tag: string): string {
  if (!tag) return "t-stone";
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return TAG_CLASSES[Math.abs(hash) % TAG_CLASSES.length];
}

// CSS extracted verbatim from the reference HTML so the generated file is
// self-contained and renders identically when opened locally.
const MOM_CSS = `:root{--paper:#f6f7fa;--paper-2:#f0f1f5;--paper-3:#e7e9ee;--white:#ffffff;--ink:#0d0e13;--ink-2:#393b46;--ink-3:#686b77;--muted:#686b77;--muted-2:#989aa8;--line:#e3e5eb;--line-2:#d0d3da;--accent:#06b6d4;--accent-2:#22d3ee;--accent-soft:#cffafe;--tint-blue:#E7EEF5;--tint-blue-ink:#2C4D6E;--tint-green:#dcfce7;--tint-green-ink:#15803d;--tint-amber:#F3EBD9;--tint-amber-ink:#6B4E1F;--tint-rose:#F5E5E3;--tint-rose-ink:#7C3A36;--tint-violet:#ECE7F1;--tint-violet-ink:#52407A;--tint-stone:#ECEAE3;--tint-stone-ink:#3F3D38;--radius-lg:16px;--radius:12px;--radius-sm:8px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:96px}
body{margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:16px;line-height:1.6;color:var(--ink-2);background:var(--paper);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-feature-settings:"ss01","cv11"}
::selection{background:var(--accent);color:white}
.serif{font-family:'Fraunces',Georgia,serif;font-weight:500;font-variation-settings:"SOFT" 50}
.mono{font-family:'JetBrains Mono',monospace}.tnum{font-variant-numeric:tabular-nums}
.page{max-width:1080px;margin:0 auto;padding:32px 32px 96px}
@media(max-width:700px){.page{padding:24px 20px 64px}}
.toc{position:sticky;top:16px;z-index:50;margin-bottom:32px;padding:8px;background:rgba(251,250,245,0.85);backdrop-filter:saturate(180%) blur(14px);-webkit-backdrop-filter:saturate(180%) blur(14px);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 24px -16px rgba(0,0,0,0.12),0 1px 0 rgba(255,255,255,0.6) inset}
.toc-inner{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.toc-inner::-webkit-scrollbar{display:none}
.toc a{position:relative;display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;color:var(--muted-2);text-decoration:none;font-size:13px;font-weight:500;letter-spacing:-0.005em;white-space:nowrap;transition:background 220ms ease,color 220ms ease,transform 220ms ease,box-shadow 220ms ease;flex-shrink:0;border:1px solid transparent}
.toc a .n{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:500;color:var(--muted-2);letter-spacing:0.04em;transition:color 220ms ease;opacity:0.7}
.toc a:hover{background:var(--paper-2);color:var(--ink-2);border-color:var(--line)}.toc a:hover .n{color:var(--muted);opacity:1}
.toc a.active{background:var(--accent);color:#FFFFFF;font-weight:600;border-color:var(--accent);transform:scale(1.03);box-shadow:0 6px 18px -6px rgba(6,182,212,0.45),0 2px 6px rgba(13,14,19,0.18),inset 0 1px 0 rgba(255,255,255,0.08)}
.toc a.active .n{color:rgba(255,255,255,0.85);opacity:1;font-weight:600}
.toc a.active::after{content:'';position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);width:18px;height:2px;border-radius:2px;background:var(--accent)}
@media(max-width:700px){.toc{top:8px}.toc a{padding:7px 11px;font-size:12.5px}}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;background:var(--white);border:1px solid var(--line);border-radius:999px;margin-bottom:56px;box-shadow:0 1px 0 rgba(0,0,0,0.02)}
.topbar .brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;color:var(--ink);letter-spacing:-0.01em}
.topbar .brand .mark{width:26px;height:26px;border-radius:7px;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-weight:600;font-size:15px}
.topbar .right{display:flex;gap:8px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);letter-spacing:0.06em;text-transform:uppercase}
.topbar .pill{padding:5px 11px;border-radius:999px;background:var(--paper-2);color:var(--ink-3);border:1px solid var(--line)}
.topbar .pill.live{color:var(--tint-green-ink);background:var(--tint-green);border-color:#C7D4C0}
.hero{margin-bottom:80px}
.hero-eyebrow{display:inline-flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:500;color:var(--accent);background:var(--accent-soft);border:1px solid #bbf7d0;padding:5px 11px;border-radius:999px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:28px}
.hero-eyebrow::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent)}
.hero h1{font-family:'Fraunces',Georgia,serif;font-weight:500;font-variation-settings:"SOFT" 50;font-size:clamp(40px,5.4vw,72px);line-height:1.04;letter-spacing:-0.025em;color:var(--ink);margin:0 0 24px}
.hero h1 .ital{font-style:italic;color:var(--accent)}
.hero .lede{font-size:19px;line-height:1.55;color:var(--ink-3);max-width:65ch;margin:0 0 48px;font-weight:400}
.hero .lede strong{color:var(--ink);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
@media(max-width:980px){.stats{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{padding:22px 22px 20px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius);transition:border-color 200ms ease,transform 200ms ease}
.stat:hover{border-color:var(--line-2);transform:translateY(-1px)}
.stat .label{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:12px}
.stat .value{font-family:'Fraunces',serif;font-weight:500;font-variation-settings:"SOFT" 50;font-size:40px;line-height:1;letter-spacing:-0.025em;color:var(--ink);font-variant-numeric:tabular-nums}
.stat .value sub{font-size:0.35em;font-family:'Inter',sans-serif;color:var(--muted);margin-left:4px;vertical-align:super;letter-spacing:0;font-weight:500}
.stat .delta{margin-top:8px;font-size:12.5px;color:var(--muted);line-height:1.45}
.stat.accent-claret{border-color:#bbf7d0}.stat.accent-claret .value{color:var(--accent)}
.stat.accent-green{border-color:#C7D4C0}.stat.accent-green .value{color:var(--tint-green-ink)}
section{margin-bottom:72px}section:last-child{margin-bottom:0}
.sec-head{display:flex;align-items:baseline;gap:20px;margin-bottom:28px}
.sec-num{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;color:var(--muted-2);letter-spacing:0.06em;padding-top:8px}
.sec-titlewrap{flex:1}
.sec-title{font-family:'Fraunces',serif;font-weight:500;font-variation-settings:"SOFT" 50;font-size:clamp(28px,3vw,36px);line-height:1.1;letter-spacing:-0.022em;color:var(--ink);margin:0 0 6px}
.sec-title .ital{font-style:italic;color:var(--accent)}
.sec-sub{font-size:14.5px;color:var(--muted);line-height:1.5;max-width:60ch}
.exec{padding:36px 40px;background:var(--tint-stone);border:1px solid var(--line);border-radius:var(--radius-lg)}
.exec p{font-family:'Fraunces',serif;font-weight:400;font-size:clamp(20px,1.9vw,24px);line-height:1.5;color:var(--ink);margin:0;letter-spacing:-0.01em}
.exec p strong{font-weight:600;color:var(--accent);font-style:italic}
.sentiment-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:20px}
@media(max-width:900px){.sentiment-grid{grid-template-columns:1fr}}
.sent-card{padding:32px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-lg)}
.sent-head{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:24px}
.sent-bar{margin-bottom:22px}.sent-bar:last-child{margin-bottom:0}
.sent-bar .row1{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}
.sent-bar .name{font-size:15px;font-weight:600;color:var(--ink);letter-spacing:-0.005em;display:flex;align-items:center;gap:10px}
.sent-bar .name .dot{width:10px;height:10px;border-radius:3px}
.sent-bar.pos .name .dot{background:var(--tint-green-ink)}.sent-bar.neu .name .dot{background:var(--tint-blue-ink)}.sent-bar.neg .name .dot{background:var(--tint-amber-ink)}
.sent-bar .pct{font-family:'Fraunces',serif;font-weight:500;font-size:22px;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
.sent-bar .track{height:10px;background:var(--paper-2);border-radius:6px;overflow:hidden}
.sent-bar .fill{height:100%;border-radius:6px}
.sent-bar.pos .fill{background:var(--tint-green-ink)}.sent-bar.neu .fill{background:var(--tint-blue-ink)}.sent-bar.neg .fill{background:var(--tint-amber-ink)}
.sent-bar .note{font-size:13.5px;color:var(--muted);margin-top:8px;line-height:1.5}
.quotes-card{padding:32px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-lg);position:relative;overflow:hidden}
/* The quote list is taken out of flow so the card's height is driven by the
   Tone Distribution card next to it (the grid stretches both to equal height);
   the list then scrolls inside that fixed height instead of stretching the row. */
.quotes-scroll{position:absolute;left:32px;right:20px;top:60px;bottom:24px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
.quotes-scroll::-webkit-scrollbar{width:6px}.quotes-scroll::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:3px}.quotes-scroll::-webkit-scrollbar-track{background:transparent}
@media(max-width:900px){.quotes-card{overflow:visible}.quotes-scroll{position:static;left:auto;right:auto;top:auto;bottom:auto}}
.quote{padding:18px 0;border-bottom:1px solid var(--line)}.quote:last-child{border-bottom:none;padding-bottom:0}.quote:first-of-type{padding-top:6px}
.quote .q{font-family:'Fraunces',serif;font-weight:400;font-size:17px;line-height:1.5;color:var(--ink);letter-spacing:-0.005em;font-style:italic;margin-bottom:10px}
.quote .q::before{content:'\\201C';color:var(--accent);margin-right:2px;font-style:normal}
.quote .q::after{content:'\\201D';color:var(--accent);margin-left:2px;font-style:normal}
.quote .who{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.quote .who .av{width:22px;height:22px;border-radius:50%;background:var(--paper-2);color:var(--ink-2);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;letter-spacing:0.04em}
.quote .who strong{color:var(--ink-2);font-weight:600}
.ud{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:900px){.ud{grid-template-columns:1fr}}
.ud-card{padding:32px;border:1px solid var(--line);border-radius:var(--radius-lg)}
.ud-card.up{background:var(--tint-green);border-color:#C7D4C0}.ud-card.down{background:var(--tint-amber);border-color:#E0D2B0}
.ud-head{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.ud-icon{width:38px;height:38px;border-radius:11px;background:var(--white);border:1px solid rgba(0,0,0,0.08);display:flex;align-items:center;justify-content:center}
.ud-card.up .ud-icon{color:var(--tint-green-ink)}.ud-card.down .ud-icon{color:var(--tint-amber-ink)}
.ud-title{font-family:'Fraunces',serif;font-weight:500;font-size:22px;color:var(--ink);letter-spacing:-0.015em}
.ud-count{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:500;padding:4px 10px;background:var(--white);border:1px solid rgba(0,0,0,0.08);border-radius:999px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.ud-card ul{list-style:none;margin:0;padding:0}
.ud-card li{display:grid;grid-template-columns:22px 1fr;gap:12px;padding:14px 0;border-top:1px solid rgba(0,0,0,0.08);font-size:14.5px;color:var(--ink-3);line-height:1.55}
.ud-card li:first-child{border-top:none;padding-top:4px}.ud-card li:last-child{padding-bottom:0}
.ud-card .ic{width:20px;height:20px;border-radius:50%;background:var(--white);display:flex;align-items:center;justify-content:center;margin-top:1px;flex-shrink:0}
.ud-card.up .ic{color:var(--tint-green-ink)}.ud-card.down .ic{color:var(--tint-amber-ink)}
.ud-card .ic svg{width:11px;height:11px}
.ud-card li strong{display:block;color:var(--ink);font-weight:600;margin-bottom:2px;letter-spacing:-0.005em}
.mom-card{padding:0;overflow:hidden;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-lg)}
.mom-item{display:grid;grid-template-columns:130px 1fr;gap:32px;padding:28px 32px;border-bottom:1px solid var(--line)}
.mom-item:last-child{border-bottom:none}
.mom-stamp{padding-top:4px}
.mom-stamp .t{font-family:'Fraunces',serif;font-weight:500;font-size:26px;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-0.022em;line-height:1;margin-bottom:6px}
.mom-stamp .l{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase}
.mom-tag{display:inline-flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;padding:3px 9px;border-radius:5px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:10px}
.mom-tag.t-blue{background:var(--tint-blue);color:var(--tint-blue-ink)}
.mom-tag.t-green{background:var(--tint-green);color:var(--tint-green-ink)}
.mom-tag.t-amber{background:var(--tint-amber);color:var(--tint-amber-ink)}
.mom-tag.t-violet{background:var(--tint-violet);color:var(--tint-violet-ink)}
.mom-tag.t-rose{background:var(--tint-rose);color:var(--tint-rose-ink)}
.mom-tag.t-stone{background:var(--tint-stone);color:var(--tint-stone-ink)}
.mom-topic{font-size:18px;font-weight:600;color:var(--ink);letter-spacing:-0.012em;margin-bottom:8px;line-height:1.3}
.mom-body{font-size:14.5px;color:var(--ink-3);line-height:1.65;max-width:70ch}
.mom-body strong{color:var(--ink);font-weight:600}
.mom-body ul{margin:10px 0 0;padding-left:20px}.mom-body li{margin-bottom:4px}
@media(max-width:720px){.mom-item{grid-template-columns:1fr;gap:10px;padding:22px 24px}.mom-stamp{display:flex;align-items:baseline;gap:14px;padding-top:0}.mom-stamp .t{margin-bottom:0;font-size:22px}}
.tbl-card{border:1px solid var(--line);border-radius:var(--radius-lg);overflow:hidden;background:var(--white)}
.tbl-scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:760px}
thead th{background:var(--paper-2);text-align:left;padding:16px 22px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap}
thead th.center{text-align:center}
tbody td{padding:18px 22px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-3)}
tbody tr:last-child td{border-bottom:none}
tbody tr{transition:background 200ms ease}tbody tr:hover{background:var(--paper)}
tbody td.center{text-align:center}
td.idx{font-family:'Fraunces',serif;font-weight:500;font-size:18px;color:var(--accent);font-variant-numeric:tabular-nums;width:48px;line-height:1}
td.task strong{display:block;color:var(--ink);font-weight:600;font-size:14.5px;margin-bottom:4px;letter-spacing:-0.005em}
td.task span{font-size:13px;color:var(--muted);line-height:1.5}
td.owner{color:var(--ink-2);font-weight:500;font-size:13.5px;white-space:nowrap}
td.owner .av{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-size:10px;font-weight:700;margin-right:10px;vertical-align:middle;color:white;letter-spacing:0.03em}
td.owner .av-stack{display:inline-flex;align-items:center;vertical-align:middle;margin-right:10px}
td.owner .av-stack .av{margin-right:0;margin-left:-9px;border:2px solid var(--white);box-shadow:0 0 0 1px var(--line)}
td.owner .av-stack .av:first-child{margin-left:0}
td.owner .owner-count{font-size:12.5px;color:var(--muted);font-weight:500}
td.due{font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.chip{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;border:1px solid transparent}
.chip.high{background:var(--tint-rose);color:var(--tint-rose-ink);border-color:#E5C9C6}
.chip.med{background:var(--tint-amber);color:var(--tint-amber-ink);border-color:#E0D2B0}
.chip.low{background:var(--tint-green);color:var(--tint-green-ink);border-color:#C7D4C0}
.chip.open{background:var(--tint-blue);color:var(--tint-blue-ink);border-color:#C8D5E2}
.chip.prog{background:var(--tint-amber);color:var(--tint-amber-ink);border-color:#E0D2B0}
.chip.plan{background:var(--tint-stone);color:var(--tint-stone-ink);border-color:var(--line-2)}
.todos{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:1000px){.todos{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.todos{grid-template-columns:1fr}}
.todo{padding:26px 26px 22px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-lg);transition:transform 200ms ease,border-color 200ms ease}
.todo:hover{transform:translateY(-2px);border-color:var(--line-2)}
.todo .top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px}
.todo .n{font-family:'Fraunces',serif;font-weight:500;font-size:48px;color:var(--accent);line-height:0.9;letter-spacing:-0.04em;font-variant-numeric:tabular-nums}
.todo .pri{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);padding:3px 8px;background:var(--paper-2);border-radius:4px}
.todo .t{font-weight:600;font-size:16px;color:var(--ink);margin-bottom:6px;letter-spacing:-0.01em;line-height:1.3}
.todo .d{font-size:13.5px;color:var(--muted);line-height:1.55;margin-bottom:16px}
.todo .meta{display:flex;align-items:center;gap:10px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-3)}
.todo .meta .av{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:white;letter-spacing:0.03em}
.todo .meta .due{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--muted)}
.risks{display:flex;flex-direction:column;gap:12px}
.risk{display:grid;grid-template-columns:48px 1fr 160px;gap:20px;padding:24px 28px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-lg);align-items:start;position:relative}
.risk::before{content:'';position:absolute;left:0;top:24px;bottom:24px;width:3px;border-radius:0 3px 3px 0;background:var(--tint-amber-ink)}
.risk.blocker::before{background:var(--accent)}
.risk .icon{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--tint-amber);color:var(--tint-amber-ink)}
.risk.blocker .icon{background:var(--tint-rose);color:var(--accent)}
.risk .body .h{font-size:16px;font-weight:600;color:var(--ink);margin-bottom:8px;letter-spacing:-0.01em;display:flex;align-items:center;gap:10px}
.risk .body .h .badge{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:600;letter-spacing:0.08em;padding:3px 8px;border-radius:4px;background:var(--tint-amber);color:var(--tint-amber-ink);border:1px solid #E0D2B0;text-transform:uppercase}
.risk.blocker .body .h .badge{background:var(--tint-rose);color:var(--accent);border-color:#E5C9C6}
.risk .body .d{font-size:13.5px;color:var(--muted);line-height:1.6;max-width:64ch}
.risk .right{text-align:right;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;line-height:1.5}
.risk .right .o{color:var(--ink-2);font-weight:600;text-transform:none;letter-spacing:-0.005em;font-size:13.5px;display:block;margin-top:6px}
@media(max-width:720px){.risk{grid-template-columns:40px 1fr;gap:14px;padding:20px}.risk .right{grid-column:1/-1;text-align:left;padding-top:12px;border-top:1px solid var(--line)}}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:900px){.steps{grid-template-columns:1fr}}
.step{padding:28px;border-radius:var(--radius-lg);border:1px solid var(--line);position:relative;overflow:hidden}
.step.s1{background:var(--tint-blue);border-color:#C8D5E2}
.step.s2{background:var(--tint-violet);border-color:#D1C7DC}
.step.s3{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.step .l{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px}
.step.s1 .l{color:var(--tint-blue-ink)}.step.s2 .l{color:var(--tint-violet-ink)}.step.s3 .l{color:var(--accent-2)}
.step .t{font-family:'Fraunces',serif;font-weight:500;font-size:24px;line-height:1.15;letter-spacing:-0.018em;margin-bottom:8px;color:var(--ink)}
.step.s3 .t{color:var(--paper)}
.step .d{font-size:13.5px;line-height:1.6;color:var(--ink-3)}.step.s3 .d{color:rgba(255,255,255,0.7)}
.step-num{font-family:'Fraunces',serif;font-weight:500;font-size:140px;line-height:0.85;position:absolute;top:-8px;right:12px;letter-spacing:-0.06em;font-variant-numeric:tabular-nums;pointer-events:none;opacity:0.06}
.step.s3 .step-num{opacity:0.08;color:var(--paper)}
/* Bullet-list fallback for The Path Forward when there are 4+ milestones. */
.steps-list{list-style:none;margin:0;padding:24px 28px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius-lg);display:flex;flex-direction:column}
.steps-list li{display:grid;grid-template-columns:120px 1fr;gap:20px;padding:16px 0;border-top:1px solid var(--line);align-items:start}
.steps-list li:first-child{border-top:none;padding-top:4px}
.steps-list li:last-child{padding-bottom:4px}
.steps-list .period{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent);padding-top:3px;white-space:nowrap}
.steps-list .body{display:flex;flex-direction:column;gap:4px;font-size:13.5px;line-height:1.6;color:var(--ink-3)}
.steps-list .body strong{color:var(--ink);font-weight:600;font-size:15px;letter-spacing:-0.005em}
@media(max-width:720px){.steps-list li{grid-template-columns:1fr;gap:6px}.steps-list .period{padding-top:0}}
/* Attendees: 5-col card grid with per-card avatar-tinted corner glow.
   Each card pulls its color from the inline --avc variable set in
   renderAttendees(). */
/* 5 cards per row on desktop, gracefully stepping down on smaller widths. */
.attendees{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
@media(max-width:1080px){.attendees{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:880px){.attendees{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:640px){.attendees{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.attendees{grid-template-columns:1fr}}
.attendee{display:flex;align-items:center;gap:12px;padding:14px 14px;background:var(--white);border:1px solid var(--line);border-radius:var(--radius);transition:transform 220ms cubic-bezier(0.16,1,0.3,1),border-color 220ms ease,box-shadow 220ms ease;position:relative;overflow:hidden}
/* Subtle avatar-color glow in the bottom-right of every card for personality. */
.attendee::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 100% 100%,color-mix(in srgb,var(--avc,var(--accent)) 12%,transparent),transparent 60%);opacity:0.55;pointer-events:none;transition:opacity 220ms ease}
/* Animated accent indicator bar on the left edge, swells in on hover. */
.attendee::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:0;background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--avc,var(--accent)) 60%,var(--accent)));border-radius:0 3px 3px 0;transition:width 220ms ease}
.attendee:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--avc,var(--accent)) 45%,var(--line-2));box-shadow:0 16px 32px -14px color-mix(in srgb,var(--avc,var(--accent)) 35%,transparent),0 2px 6px rgba(0,0,0,0.05)}
.attendee:hover::after{opacity:1}
.attendee:hover::before{width:3px}
.attendee:hover .av{transform:scale(1.08) rotate(-2deg)}
.attendee:hover .presence{transform:scale(1.2)}
.av-wrap{position:relative;flex-shrink:0;z-index:1}
.attendee .av{width:35px;height:35px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;letter-spacing:0.04em;transition:transform 260ms cubic-bezier(0.16,1,0.3,1);box-shadow:inset 0 0 0 2px rgba(255,255,255,0.14),0 2px 5px rgba(0,0,0,0.2)}
.attendee .presence{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:var(--accent);border:2px solid var(--white);box-shadow:0 0 0 1px var(--line),0 0 8px rgba(6,182,212,0.4);transition:transform 220ms ease}
.attendee .meta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;position:relative;z-index:1}
.attendee .name{font-weight:600;font-size:14px;color:var(--ink);line-height:1.2;letter-spacing:-0.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
footer{margin-top:80px;padding-top:28px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted);flex-wrap:wrap;gap:12px}
footer strong{color:var(--ink-2);font-weight:600}
footer .right{display:flex;gap:14px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em}
.reveal{opacity:0;transform:translateY(10px);animation:rise 600ms cubic-bezier(0.16,1,0.3,1) forwards}
.reveal.d1{animation-delay:60ms}.reveal.d2{animation-delay:120ms}.reveal.d3{animation-delay:180ms}
@keyframes rise{to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms !important;transition-duration:0.01ms !important}.reveal{opacity:1;transform:none}}
@media print{body{background:white}section{page-break-inside:avoid}}
/* ---- theme toggle ---- */
:root{color-scheme:light}
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border-radius:999px;border:1px solid var(--line);background:var(--paper-2);color:var(--ink-3);cursor:pointer;transition:background 200ms ease,color 200ms ease,border-color 200ms ease,transform 200ms ease}
.theme-toggle:hover{color:var(--ink);border-color:var(--line-2);transform:scale(1.05)}
.theme-toggle svg{width:15px;height:15px;display:block}
.theme-toggle .i-sun{display:none}.theme-toggle .i-moon{display:block}
/* ---- dark mode ---- */
html[data-theme="dark"]{color-scheme:dark;--paper:#09090c;--paper-2:#1a1c23;--paper-3:#22242c;--white:#121319;--ink:#f7f8fb;--ink-2:#d4d6dd;--ink-3:#9b9faa;--muted:#9b9faa;--muted-2:#696c77;--line:#272933;--line-2:#383b48;--accent:#22d3ee;--accent-2:#67e8f9;--accent-soft:#083344;--tint-blue:#162234;--tint-blue-ink:#9CBAD6;--tint-green:#052e16;--tint-green-ink:#86efac;--tint-amber:#2A2414;--tint-amber-ink:#D7BD86;--tint-rose:#2E1B1A;--tint-rose-ink:#DBA59F;--tint-violet:#221C2E;--tint-violet-ink:#B7A7D6;--tint-stone:#1f2229;--tint-stone-ink:#C8C3B6}
html[data-theme="dark"] body{background:var(--paper)}
html[data-theme="dark"] .theme-toggle .i-moon{display:none}html[data-theme="dark"] .theme-toggle .i-sun{display:block}
html[data-theme="dark"] .toc{background:rgba(20,19,16,0.85);box-shadow:0 8px 24px -16px rgba(0,0,0,0.6),0 1px 0 rgba(255,255,255,0.04) inset}
html[data-theme="dark"] .ud-card.up{border-color:#2E4327}html[data-theme="dark"] .ud-card.down{border-color:#473C20}
html[data-theme="dark"] .ud-icon,html[data-theme="dark"] .ud-count{border-color:rgba(255,255,255,0.10)}
html[data-theme="dark"] .ud-card li{border-top-color:rgba(255,255,255,0.07)}
html[data-theme="dark"] .hero-eyebrow{border-color:#14532d}
html[data-theme="dark"] .topbar .pill.live{border-color:#2E4327}
html[data-theme="dark"] .chip{border-color:rgba(255,255,255,0.10)}
html[data-theme="dark"] .step.s1{border-color:#27384A}html[data-theme="dark"] .step.s2{border-color:#3A2F4D}
html[data-theme="dark"] .risk .body .h .badge{border-color:#473C20}html[data-theme="dark"] .risk.blocker .body .h .badge{border-color:#4A2A30}
/* In dark mode --ink flips to light, so elements that used it as a dark
   background (the active nav pill and the s3 "emphasis" step card) would turn
   light with unreadable white text. Re-style them around the brand accent. */
html[data-theme="dark"] .toc a.active{background:var(--accent);border-color:var(--accent);color:#FFFFFF;box-shadow:0 6px 18px -6px rgba(34,211,238,0.5),0 2px 6px rgba(0,0,0,0.3)}
html[data-theme="dark"] .toc a.active .n{color:rgba(13,14,19,0.7)}
html[data-theme="dark"] .step.s3{background:var(--accent-soft);border-color:#14532d;color:var(--ink)}
html[data-theme="dark"] .step.s3 .t{color:var(--ink)}
html[data-theme="dark"] .step.s3 .d{color:var(--ink-3)}
html[data-theme="dark"] .step.s3 .step-num{color:var(--accent);opacity:0.14}
html[data-theme="dark"] .attendee:hover{box-shadow:0 18px 36px -16px color-mix(in srgb,var(--avc,var(--accent)) 45%,transparent),0 2px 6px rgba(0,0,0,0.5)}
html[data-theme="dark"] .attendee .av{box-shadow:inset 0 0 0 2px rgba(255,255,255,0.08),0 2px 5px rgba(0,0,0,0.5)}
html[data-theme="dark"] .attendee .presence{box-shadow:0 0 0 1px var(--line-2),0 0 8px rgba(34,211,238,0.5)}`;
