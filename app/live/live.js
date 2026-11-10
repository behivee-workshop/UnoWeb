(function () {
        "use strict";
        const {
          iconSvg,
          NOTE_NAMES,
          midiName,
          RANGE,
          ROW_H,
          buildKeyColumn,
          centerOn,
          createDeviceManager,
          createMetronome,
        } = window.KB;

        createMetronome({
          playBtn: document.getElementById("metroPlay"),
          bpmDown: document.getElementById("bpmDown"),
          bpmUp: document.getElementById("bpmUp"),
          bpmReadout: document.getElementById("bpmReadout"),
          beatDot: document.getElementById("beatDot"),
        });

        /* ---------------- device settings drawer ---------------- */
        const panelMain = document.getElementById("panelMain");
        const panelDevice = document.getElementById("panelDevice");
        const settingsBtn = document.getElementById("settingsBtn");
        let onDevice = false;
        settingsBtn.addEventListener("click", () => {
          onDevice = !onDevice;
          panelMain.inert = onDevice;
          panelMain.setAttribute("aria-hidden", String(onDevice));
          panelDevice.classList.toggle("active", onDevice);
          settingsBtn.setAttribute("aria-pressed", String(onDevice));
          settingsBtn.setAttribute("aria-expanded", String(onDevice));
        });
        window.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && onDevice) settingsBtn.click();
        });

        const liveHelpBtn = document.getElementById("liveHelpBtn");
        const liveHelp = document.getElementById("liveHelp");
        function setLiveHelp(open) {
          liveHelp.hidden = !open;
          liveHelpBtn.setAttribute("aria-expanded", String(open));
        }
        liveHelpBtn.addEventListener("click", () =>
          setLiveHelp(liveHelp.hidden),
        );
        window.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && !liveHelp.hidden) setLiveHelp(false);
        });

        /* ================= VIEWER ================= */
        const chordCard = document.getElementById("chordCard");
        const chordValue = document.getElementById("chordValue");
        const seqBanner = document.getElementById("seqBanner");
        const seqBannerText = document.getElementById("seqBannerText");
        const historyStrip = document.getElementById("historyStrip");
        const stageIdle = document.getElementById("stageIdle");
        const canvas = document.getElementById("roll");
        const ctx = canvas.getContext("2d");

        const CHORD_FORMULAS = [
          { name: "maj7", ivs: [0, 4, 7, 11] },
          { name: "m7", ivs: [0, 3, 7, 10] },
          { name: "7", ivs: [0, 4, 7, 10] },
          { name: "m7b5", ivs: [0, 3, 6, 10] },
          { name: "dim7", ivs: [0, 3, 6, 9] },
          { name: "6", ivs: [0, 4, 7, 9] },
          { name: "m6", ivs: [0, 3, 7, 9] },
          { name: "maj", ivs: [0, 4, 7] },
          { name: "m", ivs: [0, 3, 7] },
          { name: "dim", ivs: [0, 3, 6] },
          { name: "aug", ivs: [0, 4, 8] },
          { name: "sus2", ivs: [0, 2, 7] },
          { name: "sus4", ivs: [0, 5, 7] },
        ];
        const INTERVAL_NAMES = [
          "unison",
          "minor 2nd",
          "major 2nd",
          "minor 3rd",
          "major 3rd",
          "4th",
          "tritone",
          "5th",
          "minor 6th",
          "major 6th",
          "minor 7th",
          "major 7th",
        ];
        function suffixDisplay(name) {
          return name === "maj" ? "" : name;
        }
        function setsEqual(a, b) {
          return a.length === b.length && a.every((v, i) => v === b[i]);
        }

        function detectChord(heldMidis) {
          const bySorted = [...heldMidis].sort((a, b) => a - b);
          if (bySorted.length === 0) return null;
          if (bySorted.length === 1)
            return (
              midiName(bySorted[0])
                .replace(/-?\d+$/, "")
                .trim() || midiName(bySorted[0])
            );
          const pcs = [...new Set(bySorted.map((m) => m % 12))];
          const bassPc = bySorted[0] % 12;
          if (pcs.length === 2) {
            const d = (((pcs[1] - pcs[0]) % 12) + 12) % 12;
            const semis = Math.min(d, 12 - d) === d ? d : 12 - d;
            return `${NOTE_NAMES[bassPc]} + ${INTERVAL_NAMES[semis] || semis + " st"}`;
          }
          let candidates = [];
          for (const root of pcs) {
            const ivs = pcs
              .map((pc) => (((pc - root) % 12) + 12) % 12)
              .sort((a, b) => a - b);
            const f = CHORD_FORMULAS.find(
              (f) => f.ivs.length === pcs.length && setsEqual(f.ivs, ivs),
            );
            if (f) candidates.push({ root, f });
          }
          if (candidates.length) {
            const best =
              candidates.find((c) => c.root === bassPc) || candidates[0];
            return NOTE_NAMES[best.root] + suffixDisplay(best.f.name);
          }
          return pcs.map((pc) => NOTE_NAMES[pc]).join(" · ");
        }

        const SEQ_PATTERNS = [
          { name: "Major Scale", deltas: [2, 2, 1, 2, 2, 2, 1] },
          { name: "Natural Minor Scale", deltas: [2, 1, 2, 2, 1, 2, 2] },
          { name: "Major Arpeggio", deltas: [4, 3, 5] },
          { name: "Minor Arpeggio", deltas: [3, 4, 5] },
          { name: "Dominant 7th Arpeggio", deltas: [4, 3, 3] },
        ].sort((a, b) => b.deltas.length - a.deltas.length);

        let noteLog = [];
        let lastSeqSignature = "";
        let seqBannerTimer = null;
        function checkSequence() {
          const pitches = noteLog.map((n) => n.midi);
          if (pitches.length < 4) return;
          const deltas = pitches.slice(1).map((m, i) => m - pitches[i]);
          for (const pat of SEQ_PATTERNS) {
            if (deltas.length < pat.deltas.length) continue;
            const tail = deltas.slice(-pat.deltas.length);
            if (setsEqual(tail, pat.deltas)) {
              const sig = pat.name + ":" + pitches.length;
              if (sig !== lastSeqSignature) {
                lastSeqSignature = sig;
                const played = pitches
                  .slice(-(pat.deltas.length + 1))
                  .map(midiName)
                  .join(" → ");
                showSeqBanner(`${pat.name}  ·  ${played}`);
              }
              return;
            }
          }
          if (deltas.length >= 5) {
            const tail5 = deltas.slice(-5);
            if (tail5.every((d) => d === 1) || tail5.every((d) => d === -1)) {
              const sig = "Chromatic:" + pitches.length;
              if (sig !== lastSeqSignature) {
                lastSeqSignature = sig;
                showSeqBanner(
                  "Chromatic Run · " +
                    (tail5[0] > 0 ? "ascending" : "descending"),
                );
              }
            }
          }
        }
        function showSeqBanner(text) {
          seqBannerText.textContent = text;
          seqBanner.classList.add("show");
          clearTimeout(seqBannerTimer);
          seqBannerTimer = setTimeout(
            () => seqBanner.classList.remove("show"),
            3200,
          );
        }

        function pushHistory(midi) {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = midiName(midi);
          historyStrip.appendChild(chip);
          while (historyStrip.children.length > 24)
            historyStrip.removeChild(historyStrip.firstChild);
          historyStrip.scrollLeft = historyStrip.scrollWidth;
        }

        /* ---- note chart: each note-on punches a diamond and traces a flat line for as long as it's held ---- */
        const WINDOW_MS = 6000;
        const MIDDLE_C = 60;
        function hue(midi) {
          return (midi * 29) % 360;
        }
        let strokes = []; // {midi, t0, t1|null, color}
        let chordStamps = [];
        let lastChordLabel = null;

        const heldNotes = new Set();
        function maybeStampChord(label) {
          if (label && label !== lastChordLabel) {
            chordStamps.push({ t: performance.now(), label });
            if (chordStamps.length > 12) chordStamps.shift();
          }
          lastChordLabel = label || lastChordLabel;
        }

        let idleTimer = null;
        function viewerNoteOn(midi, vel) {
          heldNotes.add(midi);
          noteLog.push({ midi, t: performance.now() });
          if (noteLog.length > 32) noteLog.shift();
          pushHistory(midi);
          checkSequence();
          const label = detectChord(heldNotes);
          chordValue.textContent = label || "—";
          chordValue.classList.remove("empty");
          requestAnimationFrame(updateChordCardPosition);
          stageIdle.classList.add("hide");
          clearTimeout(idleTimer);
          maybeStampChord(label);
          strokes.push({
            midi,
            vel: vel ?? 100,
            t0: performance.now(),
            t1: null,
            color: `hsl(${hue(midi)} 78% 62%)`,
          });
        }
        function viewerNoteOff(midi) {
          heldNotes.delete(midi);
          const s = strokes
            .slice()
            .reverse()
            .find((s) => s.midi === midi && s.t1 === null);
          if (s) s.t1 = performance.now();
          if (heldNotes.size) {
            const label = detectChord(heldNotes);
            chordValue.textContent = label || "—";
            requestAnimationFrame(updateChordCardPosition);
            maybeStampChord(label);
          } else {
            lastChordLabel = null;
            idleTimer = setTimeout(() => {
              chordValue.textContent = "play a key";
              chordValue.classList.add("empty");
              requestAnimationFrame(updateChordCardPosition);
              stageIdle.classList.remove("hide");
            }, 1500);
          }
        }

        const viewerRollScroll = document.getElementById("viewerRoll");
        function updateChordCardPosition() {
          const rollRect = viewerRollScroll.getBoundingClientRect();
          const inset = 14;
          chordCard.style.maxWidth = `${Math.max(120, rollRect.width - inset * 2)}px`;
          chordCard.style.left = `${Math.max(inset, rollRect.right - chordCard.offsetWidth - inset)}px`;
          chordCard.style.top = `${Math.max(inset, rollRect.bottom - chordCard.offsetHeight - inset)}px`;
        }
        function updateStageIdlePosition() {
          const rollRect = viewerRollScroll.getBoundingClientRect();
          const inset = 16;
          stageIdle.style.maxWidth = `${Math.max(120, rollRect.width - inset * 2)}px`;
          stageIdle.style.left = `${Math.max(inset, rollRect.left + (rollRect.width - stageIdle.offsetWidth) / 2)}px`;
          stageIdle.style.top = `${Math.max(inset, rollRect.top + (rollRect.height - stageIdle.offsetHeight) / 2)}px`;
        }
        viewerRollScroll.addEventListener("scroll", updateChordCardPosition);
        viewerRollScroll.addEventListener("scroll", updateStageIdlePosition);
        window.addEventListener("scroll", updateChordCardPosition);
        window.addEventListener("scroll", updateStageIdlePosition);
        window.addEventListener("resize", updateChordCardPosition);
        window.addEventListener("resize", updateStageIdlePosition);
        new ResizeObserver(updateChordCardPosition).observe(viewerRollScroll);
        new ResizeObserver(updateStageIdlePosition).observe(viewerRollScroll);
        const viewerPianoCtl = buildKeyColumn(
          document.getElementById("viewerPianoKeys"),
          {
            keyboardMap: true,
            onNoteOn: viewerNoteOn,
            onNoteOff: viewerNoteOff,
          },
        );
        centerOn(viewerRollScroll, 60);
        updateChordCardPosition();
        updateStageIdlePosition();

        function fitCanvas() {
          const cssW = canvas.parentElement.clientWidth;
          const cssH = RANGE.length * ROW_H;
          canvas.style.width = cssW + "px";
          canvas.style.height = cssH + "px";
          canvas.width = cssW * devicePixelRatio;
          canvas.height = cssH * devicePixelRatio;
        }
        new ResizeObserver(fitCanvas).observe(canvas.parentElement);
        fitCanvas();

        function yForMidi(midi) {
          return (RANGE.indexOf(midi) + 0.5) * ROW_H;
        }
        function drawDiamond(x, y, r, color) {
          ctx.save();
          ctx.shadowBlur = 10;
          ctx.shadowColor = color;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        function renderRoll() {
          requestAnimationFrame(renderRoll);
          const cssW = canvas.width / devicePixelRatio,
            cssH = canvas.height / devicePixelRatio;
          if (!cssW || !cssH) return;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.fillStyle = "#0A0A0C";
          ctx.fillRect(0, 0, cssW, cssH);

          ctx.strokeStyle = "rgba(255,255,255,.05)";
          ctx.lineWidth = 1;
          for (let gx = cssW; gx > 0; gx -= 80) {
            ctx.beginPath();
            ctx.moveTo(gx + 0.5, 0);
            ctx.lineTo(gx + 0.5, cssH);
            ctx.stroke();
          }

          const middleCY = yForMidi(MIDDLE_C);
          ctx.strokeStyle = "rgba(72,168,255,.42)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, middleCY + 0.5);
          ctx.lineTo(cssW, middleCY + 0.5);
          ctx.stroke();

          const now = performance.now();
          chordStamps = chordStamps.filter((s) => now - s.t < WINDOW_MS + 500);
          ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
          ctx.textBaseline = "top";
          chordStamps.forEach((s) => {
            const x = cssW * (1 - (now - s.t) / WINDOW_MS);
            ctx.strokeStyle = "rgba(255,255,255,.14)";
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, cssH);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,.6)";
            ctx.fillText(s.label, x + 5, 4);
          });

          strokes = strokes.filter(
            (s) => s.t1 === null || now - s.t1 < WINDOW_MS + 500,
          );
          strokes.forEach((s) => {
            const y = yForMidi(s.midi);
            const endT = s.t1 ?? now;
            const x0 = cssW * (1 - (now - s.t0) / WINDOW_MS);
            const x1 = cssW * (1 - (now - endT) / WINDOW_MS);
            const clippedX0 = Math.max(0, x0),
              clippedX1 = Math.min(cssW, Math.max(x0, x1));
            const velT = (s.vel ?? 100) / 127;
            if (clippedX1 > clippedX0) {
              ctx.lineWidth = 1.4 + velT * 2.2;
              ctx.strokeStyle = s.color;
              ctx.shadowColor = s.color;
              ctx.shadowBlur = 5 + velT * 6;
              ctx.beginPath();
              ctx.moveTo(clippedX0, y);
              ctx.lineTo(clippedX1, y);
              ctx.stroke();
            }
            if (x0 >= -6 && x0 <= cssW)
              drawDiamond(x0, y, 3.5 + velT * 2.5, s.color);
            if (s.t1 === null) {
              ctx.save();
              ctx.shadowBlur = 13;
              ctx.fillStyle = s.color;
              ctx.beginPath();
              ctx.arc(cssW - 3, y, 4.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          });
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(255,255,255,.3)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cssW - 1, 0);
          ctx.lineTo(cssW - 1, cssH);
          ctx.stroke();
        }
        renderRoll();

        /* ================= DEVICE ================= */
        createDeviceManager({
          els: {
            quickConnectBtn: document.getElementById("quickConnectBtn"),
            statusText: document.getElementById("connectStatus"),
            rescanBtn: document.getElementById("rescanBtn"),
            inputList: document.getElementById("inputList"),
            // no outputList — Live never sends MIDI anywhere, it only visualizes input
          },
          onRealNoteOn: (midi, vel) => viewerPianoCtl.press(midi, vel),
          onRealNoteOff: (midi) => viewerPianoCtl.release(midi),
        });
      })();
