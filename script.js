/* ==========================================================================
   AgendApp Escolar · Plataforma de aprendizaje (ruta de 6 etapas)
   Lógica 100% local. No requiere conexión ni servidor.
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_KEY = "agendapp-plataforma-red89s19-v1";
  var TOTAL_STEPS = 6;
  var MAX_LOG = 500;
  var STEP_NAMES = { 1: "Reconoce qué debes hacer", 2: "Usa el RED", 3: "Desarrolla la actividad", 4: "Entrega tu evidencia", 5: "Recibe retroalimentación", 6: "Cierra tu proceso" };
  var TIPOS = { 1: "Error de entrada", 2: "Error de cálculo", 3: "Error de navegación" };
  var QUESTIONS = [];
  var QUIZ_INFO = {};

  function emptyCase() { return { executed: false, ok: null, obtenido: "", esperado: "", attempts: 0, history: [] }; }
  function emptyReport() { return { 1: { tipo: "", causa: "" }, 2: { tipo: "", causa: "" }, 3: { tipo: "", causa: "" } }; }

  function defaultState() {
    return {
      step: 1, startedAt: Date.now(), log: [], ack: false, opened: [], checks: {},
      cases: { 1: emptyCase(), 2: emptyCase(), 3: emptyCase() },
      report: emptyReport(), delivered: null, deliveries: 0,
      fb: { 1: "", 2: "", 3: "", ajuste: "" }, quiz: {}, quizDone: false, closed: false,
      student: { nombre: "", documento: "", grado: "", institucion: "", docente: "", reflexion: "", aprendizaje: "", dificultad: "", valoracion: "", comentario: "" }
    };
  }

  var state = loadState() || defaultState();

  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ } }
  function loadState() { try { var raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  function getPath(p) { return p.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, state); }
  function setPath(p, v) {
    var k = p.split("."), o = state;
    for (var i = 0; i < k.length - 1; i++) o = o[k[i]];
    o[k[k.length - 1]] = v;
  }
  function len(v) { return String(v || "").trim().length; }

  /* --------------------------------------------------------------------
     Requisitos de cada etapa (puerta de avance)
     -------------------------------------------------------------------- */
  function evidenceChecklist() {
    var st = state.student, items = [];
    [1, 2, 3].forEach(function (c) {
      items.push([state.cases[c].executed, "Practicaste el Caso " + c]);
      items.push([!!state.report[c].tipo && len(state.report[c].causa) >= 15, "Informe del Caso " + c + ": tipo de falla y causa (mínimo una frase)"]);
    });
    items.push([len(st.nombre) > 0 && len(st.documento) > 0 && len(st.grado) > 0, "Tus datos: nombre, documento y grado"]);
    return items;
  }

  function gate(n) {
    var s = state;
    if (n === 1) return s.ack ? "" : "marca que entendiste tu misión.";
    if (n === 2) {
      if (s.opened.length < 3) return "abre y lee los 3 reportes.";
      if (!s.checks.cq1 || !s.checks.cq2) return "responde las 2 preguntas de verificación.";
      return len(s.student.reflexion) >= 15 ? "" : "escribe tu reflexión (mínimo una frase).";
    }
    if (n === 3) {
      var f = [1, 2, 3].filter(function (c) { return !s.cases[c].executed; }).length;
      return f ? "ejecuta los 3 casos (faltan " + f + ")." : "";
    }
    if (n === 4) return s.delivered ? "" : "completa la lista de verificación y entrega tu evidencia.";
    if (n === 5) {
      if (![1, 2, 3].every(function (c) { return s.fb[c]; })) return "indica qué tan cerca estuvo tu explicación en cada caso.";
      if (len(s.fb.ajuste) < 15) return "escribe qué harás diferente (mínimo una frase).";
      return s.quizDone ? "" : "responde y comprueba las 5 preguntas.";
    }
    return "";
  }

  function maxStep() { var m = 1; while (m < TOTAL_STEPS && gate(m) === "") m++; return m; }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function fmtClock(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function fmtDateTime(ts) { return fmtDate(ts) + " " + fmtClock(ts); }

  function fmtDuration(ms) {
    var min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return min + " min";
    return Math.floor(min / 60) + " h " + (min % 60) + " min";
  }

  function truncate(str, n) {
    str = String(str || "");
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function logEvent(cat, text) {
    state.log.push({ t: Date.now(), c: cat, x: text });
    if (state.log.length > MAX_LOG) state.log.shift();
  }

  /* --------------------------------------------------------------------
     Datos semilla de AgendApp (reservas ya existentes)
     -------------------------------------------------------------------- */
  var reservasExistentes = [
    { sala: "Sala de Cómputo", inicio: "08:00", fin: "09:00" },
    { sala: "Cancha", inicio: "10:00", fin: "11:00" }
  ];

  function toMinutes(hhmm) {
    if (!hhmm) return null;
    var parts = hhmm.split(":");
    if (parts.length !== 2) return null;
    var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  /* --------------------------------------------------------------------
     Motor de simulación de AgendApp (con las 3 fallas reales incluidas)
     -------------------------------------------------------------------- */

  function ejecutarCaso1(sala, inicio, fin) {
    var iniMin = toMinutes(inicio);
    var finMin = toMinutes(fin);
    if (!fin || finMin === null || (iniMin !== null && finMin <= iniMin)) {
      return {
        ok: false,
        obtenido: "Reserva CONFIRMADA para " + sala + " de " + (inicio || "--:--") +
          " a " + (fin || "--:--") + ", sin avisar que la hora de fin es inválida o falta."
      };
    }
    return {
      ok: true,
      obtenido: "Reserva confirmada correctamente para " + sala + " de " + inicio + " a " + fin + "."
    };
  }

  function ejecutarCaso2(sala, inicio, fin) {
    var iniMin = toMinutes(inicio);
    var finMin = toMinutes(fin);
    if (iniMin === null || finMin === null || finMin <= iniMin) {
      return { ok: true, obtenido: "Datos de horario incompletos: no se pudo evaluar el caso. Revisa las horas." };
    }
    var chocaBug = reservasExistentes.some(function (r) {
      var rIni = toMinutes(r.inicio), rFin = toMinutes(r.fin);
      return iniMin < rFin && finMin > rIni;
    });
    var chocaReal = reservasExistentes.some(function (r) {
      if (r.sala !== sala) return false;
      var rIni = toMinutes(r.inicio), rFin = toMinutes(r.fin);
      return iniMin < rFin && finMin > rIni;
    });
    if (chocaBug && !chocaReal) {
      return {
        ok: false,
        obtenido: "Reserva RECHAZADA para " + sala + " de " + inicio + " a " + fin +
          " por 'cruce de horario' — aunque esa sala está libre a esa hora. AgendApp comparó contra una reserva de otra sala."
      };
    }
    if (chocaReal) {
      var ex = reservasExistentes.filter(function (r) { return r.sala === sala; })[0];
      return {
        ok: true,
        obtenido: "Reserva rechazada correctamente: " + sala + " ya está ocupada de " + ex.inicio + " a " + ex.fin + "."
      };
    }
    return { ok: true, obtenido: "Reserva confirmada correctamente para " + sala + " de " + inicio + " a " + fin + ". No hay cruces." };
  }

  var reservasSesionCaso3 = [];
  function ejecutarCaso3(sala, inicio, fin) {
    reservasSesionCaso3.push({ sala: sala, inicio: inicio, fin: fin });
    var duplicadas = reservasSesionCaso3.filter(function (r) {
      return r.sala === sala && r.inicio === inicio && r.fin === fin;
    }).length;
    if (duplicadas > 1) {
      return {
        ok: false,
        obtenido: "Se crearon " + duplicadas + " reservas IDÉNTICAS para " + sala + " de " + inicio +
          " a " + fin + ". AgendApp no revisó si ya existía una reserva igual antes de confirmar otra.",
        count: duplicadas
      };
    }
    return {
      ok: true,
      obtenido: "Reserva registrada (1 de 1) para " + sala + " de " + inicio + " a " + fin +
        ". Presiona 'Confirmar de nuevo' con los mismos datos para intentar reproducir la falla.",
      count: duplicadas
    };
  }
  var caseTitles = {
    1: "Caso 1 — Error de entrada",
    2: "Caso 2 — Error de cálculo",
    3: "Caso 3 — Error de navegación"
  };

  function renderResult(caseId, ok, obtenido) {
    var box = document.getElementById("c" + caseId + "-result");
    var cls = ok ? "ok" : "fail";
    var label = ok ? "✔ Sin falla detectada" : "✘ Falla reproducida";
    box.innerHTML =
      '<div class="result__box ' + cls + '">' +
      '<span class="result__label">' + label + "</span>" +
      "<p><strong>Resultado obtenido:</strong> " + escapeHtml(obtenido) + "</p>" +
      "<p><strong>Qué significa:</strong> " + escapeHtml(caseFeedback(caseId)) + "</p>" +
      "</div>";
  }

  function updateCasosStatus() {
    var n = [1, 2, 3].filter(function (c) { return state.cases[c].executed; }).length;
    document.getElementById("casosStatus").textContent = "Casos practicados: " + n + " / 3";
    [1, 2, 3].forEach(function (c) {
      var li = document.getElementById("chk-c" + c);
      if (!li) return;
      li.textContent = (state.cases[c].executed ? "✔ " : "○ ") + caseTitles[c];
    });
  }

  function caseInputText(cs) {
    return (cs.sala || "(sin sala)") + ", " + (cs.inicio || "(vacío)") + "–" + (cs.fin || "(vacío)");
  }

  function runCase(caseId) {
    if (state.delivered) { alert("Tu evidencia ya fue entregada. Reabre la entrega en la Etapa 4 si quieres mejorarla."); return; }
    var esperado = document.getElementById("c" + caseId + "-esperado").value.trim();
    var sala = document.getElementById("c" + caseId + "-sala").value;
    var inicio = document.getElementById("c" + caseId + "-inicio").value;
    var fin = document.getElementById("c" + caseId + "-fin").value;

    if (!esperado) {
      alert("Escribe primero tu predicción de \"Resultado esperado\" antes de ejecutar el caso.");
      document.getElementById("c" + caseId + "-esperado").focus();
      return;
    }

    var r;
    if (caseId === 1) r = ejecutarCaso1(sala, inicio, fin);
    if (caseId === 2) r = ejecutarCaso2(sala, inicio, fin);
    if (caseId === 3) r = ejecutarCaso3(sala, inicio, fin);

    var prev = state.cases[caseId];
    var attempts = (prev.attempts || 0) + 1;
    var history = (prev.history || []).slice();
    history.push({
      n: attempts, t: Date.now(), sala: sala, inicio: inicio, fin: fin,
      esperado: esperado, obtenido: r.obtenido, ok: r.ok
    });

    state.cases[caseId] = {
      executed: true, ok: r.ok, obtenido: r.obtenido, esperado: esperado,
      sala: sala, inicio: inicio, fin: fin, attempts: attempts, history: history
    };

    logEvent("CASO", "Practicó el Caso " + caseId + " (intento " + attempts + "). Entrada: " +
      caseInputText(state.cases[caseId]) + ". Esperaba: «" + truncate(esperado, 120) + "». Resultado: " +
      (r.ok ? "sin falla detectada" : "falla reproducida") + ".");

    renderResult(caseId, r.ok, r.obtenido);
    updateCasosStatus();
    saveState();
    refreshNav();
  }

  /* Retroalimentación de cada caso (se muestra en Resultados y en el PDF) */
  function caseFeedback(c) {
    var cs = state.cases[c];
    if (!cs.executed) {
      return "No practicaste este caso, por eso no hay evidencia de que lo hayas probado. Vuelve a la Etapa 4 y hazlo.";
    }
    if (c === 1) {
      return cs.ok
        ? "Con esta entrada AgendApp se comportó bien, así que NO reprodujiste la falla del reporte. Para revelarla debías dejar la hora de fin vacía o poner una hora de fin igual o anterior a la de inicio. Que un caso pase no significa que el sistema esté libre de este error."
        : "Bien: reprodujiste la falla. AgendApp aceptó una hora de fin inválida (vacía o anterior al inicio). Corrección esperada: validar que la hora de fin exista y sea posterior a la de inicio, y mostrar un mensaje de error si no es así.";
    }
    if (c === 2) {
      return cs.ok
        ? "Con esta entrada AgendApp se comportó bien (o no se pudo evaluar), así que NO reprodujiste la falla del reporte. Para revelarla debías pedir una sala que esté libre en un horario que SÍ coincide con la reserva de otra sala (por ejemplo, Cancha de 08:00 a 09:00, cuando la Sala de Cómputo está ocupada)."
        : "Bien: reprodujiste la falla. AgendApp rechazó una reserva válida porque comparó el horario contra reservas de otra sala. Corrección esperada: al buscar cruces de horario, comparar solo con las reservas de la misma sala.";
    }
    return cs.ok
      ? "Con una sola confirmación todo parece correcto, así que NO reprodujiste la falla del reporte. Para revelarla debías confirmar de nuevo con exactamente los mismos datos (botón «Confirmar de nuevo»)."
      : "Bien: reprodujiste la falla. Al confirmar dos veces los mismos datos se crearon reservas idénticas. Corrección esperada: verificar si ya existe una reserva igual antes de crear otra y/o deshabilitar el botón tras el primer clic.";
  }

  var QUIZ_TEXT = {
    h1: {
      topic: "Causa del error de entrada",
      why: "AgendApp confirmó la reserva aunque la hora de fin estuviera vacía o fuera anterior a la de inicio. Eso solo ocurre si el sistema no valida la hora de fin (que exista y sea posterior al inicio). Es un error de entrada: datos inválidos que el sistema aceptó.",
      wrong: {
        b: "La duración nunca se calculó mal: el problema apareció antes, al aceptar una hora de fin inválida. Con la hora de fin vacía ni siquiera hay una duración que calcular.",
        c: "La sala sí se guardó bien (aparece en la reserva confirmada). La falla estuvo en la hora de fin, no en la sala."
      }
    },
    h2: {
      topic: "Causa del error de cálculo",
      why: "La reserva se rechazó por 'cruce de horario' aunque la sala pedida estaba libre. El sistema comparó el horario contra todas las reservas sin filtrar por sala, y por eso confundió un espacio ocupado con otro.",
      wrong: {
        b: "Si la Cancha nunca se pudiera reservar, el rechazo ocurriría a cualquier hora. El rechazo solo apareció cuando el horario coincidía con la reserva de OTRA sala.",
        c: "Las reservas anteriores seguían ahí: el sistema las usó justamente para rechazar. No se borra nada; el error está en cómo se comparan."
      }
    },
    h3: {
      topic: "Causa del error de navegación",
      why: "Al confirmar dos veces los mismos datos se crearon reservas idénticas. Falta verificar si ya existe una reserva igual antes de crear otra (o bloquear el botón después del primer clic).",
      wrong: {
        b: "La primera confirmación sí funcionó; por eso se pudo reproducir el duplicado al repetirla.",
        c: "La sala no cambió: las reservas duplicadas eran de la misma sala."
      }
    },
    q4: {
      topic: "Qué es un caso de prueba",
      why: "Un caso de prueba une una entrada concreta con el resultado que se espera, para compararlo con el resultado obtenido y decidir si hay una falla.",
      wrong: {
        b: "Una lista de errores corregidos es un historial de correcciones: no tiene entrada ni resultado esperado, así que no sirve para comparar.",
        c: "Un manual de instalación explica cómo usar el programa; no sirve para comprobar si se comporta bien."
      }
    },
    q5: {
      topic: "Por qué probar datos límite",
      why: "Los errores de comparación (como usar '<' en vez de '<=') suelen aparecer justo en los valores límite, donde dos condiciones casi coinciden.",
      wrong: {
        b: "Los errores no dependen del tamaño de los números sino de la lógica del código. Los datos límite son útiles porque ponen a prueba las comparaciones justo en el borde.",
        c: "Es al revés: los datos límite están entre los más útiles, porque revelan rápido los errores de comparación."
      }
    },
    q6: {
      topic: "Qué hacer cuando el caso coincide con lo esperado",
      why: "Que un caso pase solo demuestra que esa entrada no revela falla. Se descarta esa hipótesis y se sigue con otra entrada distinta: es el ciclo de prueba y descarte.",
      wrong: {
        a: "Un caso que pasa no prueba que todo funcione: solo cubre esa entrada. Otras entradas podrían seguir fallando.",
        c: "Un caso que pasa no está mal diseñado: aporta información al permitirte descartar una posible causa."
      }
    },
    q7: {
      topic: "Por qué escribir el resultado esperado antes de ejecutar",
      why: "Si escribes la predicción antes, no puedes ajustarla a lo que el sistema hizo. Así la comparación entre esperado y obtenido es honesta y la diferencia (si existe) revela la falla.",
      wrong: {
        a: "La predicción no cambia la velocidad del sistema: el sistema no lee lo que escribes. Sirve como referencia para comparar.",
        b: "Escribirlo antes no cambia lo que hace el sistema. Si no coinciden, esa diferencia es justamente la falla que buscas."
      }
    },
    q8: {
      topic: "Qué es depurar",
      why: "Depurar es el proceso de encontrar la causa de una falla y corregirla.",
      wrong: {
        a: "Borrar datos antiguos es mantenimiento de información; no ayuda a encontrar ni a corregir el origen de un error.",
        c: "El manual de usuario es documentación; la depuración se centra en hallar y corregir las causas de las fallas."
      }
    }
  };
  function readQuizInfo(q) {
    var fs = document.querySelector('fieldset.quiz[data-q="' + q + '"]');
    var legend = fs.querySelector("legend").cloneNode(true);
    var num = legend.querySelector(".quiz__num");
    if (num) legend.removeChild(num);
    var info = { prompt: legend.textContent.replace(/\s+/g, " ").trim(), options: {}, correct: "" };
    fs.querySelectorAll("label.radio").forEach(function (label) {
      var inp = label.querySelector("input");
      info.options[inp.value] = label.textContent.replace(/\s+/g, " ").trim();
      if (inp.getAttribute("data-correct") === "true") info.correct = inp.value;
    });
    return info;
  }

  function isCorrect(q) {
    return state.quiz[q] === QUIZ_INFO[q].correct;
  }
  /* --------------------------------------------------------------------
     Generación de PDF (sin librerías externas — PDF escrito a mano)
     Courier (monoespaciada) con codificación WinAnsi: admite tildes y ñ.
     -------------------------------------------------------------------- */
  function sanitizeForPdf(str) {
    return String(str)
      .replace(/✔/g, "[OK]")
      .replace(/✘/g, "[X]")
      .replace(/→/g, "->")
      .replace(/[–—]/g, "-")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/…/g, "...")
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")   // emojis
      .replace(/[\uFE0F\u200D]/g, "");
  }

  function escapePdfText(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      var ch = str[i];
      if (code > 255) ch = "?";
      if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
      else out += ch;
    }
    return out;
  }

  function wrapLines(text, maxChars) {
    var rawLines = text.split("\n");
    var wrapped = [];
    rawLines.forEach(function (rl) {
      if (rl.length === 0) { wrapped.push(""); return; }
      var cur = "";
      rl.split(" ").forEach(function (w) {
        while (w.length > maxChars) {            // palabras larguísimas: se parten
          if (cur) { wrapped.push(cur); cur = ""; }
          wrapped.push(w.slice(0, maxChars));
          w = w.slice(maxChars);
        }
        if ((cur + (cur ? " " : "") + w).length > maxChars) {
          wrapped.push(cur);
          cur = w;
        } else {
          cur = cur ? cur + " " + w : w;
        }
      });
      if (cur) wrapped.push(cur);
    });
    return wrapped;
  }

  var C_BLACK = [0, 0, 0], C_BLUE = [0.1, 0.25, 0.5], C_GREEN = [0.05, 0.5, 0.2],
      C_RED = [0.75, 0.1, 0.1], C_GRAY = [0.35, 0.35, 0.35];

  function PdfLayout() {
    var PAGE_W = 595, MX = 50, TOP = 800, BOTTOM = 60;
    var pages = [[]];
    var y = TOP;

    function cur() { return pages[pages.length - 1]; }
    function ensure(h) { if (y - h < BOTTOM) { pages.push([]); y = TOP; } }

    function text(str, opt) {
      opt = opt || {};
      var size = opt.size || 9;
      var indent = opt.indent || 0;
      var lead = size * 1.45;
      var maxChars = Math.floor((PAGE_W - 2 * MX - indent) / (size * 0.6));
      var lines = wrapLines(sanitizeForPdf(str), maxChars);
      if (opt.before) y -= opt.before;
      lines.forEach(function (l) {
        ensure(lead);
        y -= lead;
        cur().push({ k: "t", x: MX + indent, y: y, s: size, b: !!opt.bold, c: opt.color || C_BLACK, t: l });
      });
      if (opt.after) y -= opt.after;
    }
    function rule() {
      ensure(8);
      y -= 4;
      cur().push({ k: "r", y: y });
      y -= 4;
    }
    function heading(str) {
      ensure(60);
      text(str, { size: 11, bold: true, color: C_BLUE, before: 10 });
      rule();
    }
    function space(n) { y -= n; }

    return { text: text, rule: rule, heading: heading, space: space, keep: ensure, pages: pages };
  }

  function nf(n) { return n.toFixed(2); }

  function buildPdfBytes(pages, footerText) {
    var numPages = pages.length;
    var fontObj1 = 3 + numPages * 2;
    var fontObj2 = fontObj1 + 1;

    var pdf = "%PDF-1.4\n";
    var offsets = {};
    function addObj(num, body) {
      offsets[num] = pdf.length;
      pdf += num + " 0 obj\n" + body + "\nendobj\n";
    }

    var kidsRefs = [];
    for (var i = 0; i < numPages; i++) kidsRefs.push((3 + i) + " 0 R");

    addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    addObj(2, "<< /Type /Pages /Kids [" + kidsRefs.join(" ") + "] /Count " + numPages + " >>");

    for (i = 0; i < numPages; i++) {
      var pageObjNum = 3 + i;
      var contentObjNum = 3 + numPages + i;
      addObj(pageObjNum,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
        "/Resources << /Font << /F1 " + fontObj1 + " 0 R /F2 " + fontObj2 + " 0 R >> >> " +
        "/Contents " + contentObjNum + " 0 R >>");

      var stream = "";
      pages[i].forEach(function (op) {
        if (op.k === "t") {
          stream += "BT /" + (op.b ? "F2" : "F1") + " " + op.s + " Tf " +
            nf(op.c[0]) + " " + nf(op.c[1]) + " " + nf(op.c[2]) + " rg " +
            nf(op.x) + " " + nf(op.y) + " Td (" + escapePdfText(op.t) + ") Tj ET\n";
        } else {
          stream += "0.6 0.6 0.6 RG 0.5 w 50 " + nf(op.y) + " m 545 " + nf(op.y) + " l S\n";
        }
      });
      var foot = sanitizeForPdf(footerText) + "  |  Página " + (i + 1) + " de " + numPages;
      stream += "BT /F1 8 Tf 0.35 0.35 0.35 rg 50 32 Td (" + escapePdfText(foot) + ") Tj ET\n";
      addObj(contentObjNum, "<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream");
    }

    addObj(fontObj1, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
    addObj(fontObj2, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>");

    var totalObjs = fontObj2;
    var xrefStart = pdf.length;
    pdf += "xref\n0 " + (totalObjs + 1) + "\n";
    pdf += "0000000000 65535 f \n";
    for (var n = 1; n <= totalObjs; n++) {
      var off = String(offsets[n]);
      while (off.length < 10) off = "0" + off;
      pdf += off + " 00000 n \n";
    }
    pdf += "trailer\n<< /Size " + (totalObjs + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";

    var bytes = new Uint8Array(pdf.length);
    for (var b = 0; b < pdf.length; b++) bytes[b] = pdf.charCodeAt(b) & 0xff;
    return bytes;
  }

  /* Código de control: huella simple del contenido (no es una firma digital) */
  function hex8(n) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < 8) s = "0" + s;
    return s;
  }
  function checksum(str) {
    var h1 = 5381, h2 = 0xB7E1;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = (((h1 << 5) + h1) ^ c) >>> 0;
      h2 = (((h2 << 7) - h2) + c) >>> 0;
    }
    var a = hex8(h1), b = hex8(h2);
    return a.slice(0, 4) + "-" + a.slice(4) + "-" + b.slice(0, 4) + "-" + b.slice(4);
  }

  function slug(str) {
    var map = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" };
    return String(str).toLowerCase()
      .replace(/[áéíóúüñ]/g, function (ch) { return map[ch]; })
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }


  /* --------------------------------------------------------------------
     Navegación y estado visible
     -------------------------------------------------------------------- */
  var gateMsg, nextBtn, prevBtn;

  function refreshNav() {
    var m = maxStep(), n = state.step, g = gate(n);
    document.querySelectorAll("li[data-step]").forEach(function (li) {
      var i = parseInt(li.getAttribute("data-step"), 10);
      li.classList.toggle("is-active", i === n);
      li.classList.toggle("is-done", i < m || (i === TOTAL_STEPS && state.closed));
      li.querySelector("button").disabled = i > m;
    });
    var done = (m - 1) + (state.closed ? 1 : 0);
    document.getElementById("progressStatus").textContent = "Avance de la ruta: " + Math.round(done / TOTAL_STEPS * 100) + "%";
    document.getElementById("progressText").textContent = "Etapa " + n + " de " + TOTAL_STEPS;
    if (n === TOTAL_STEPS) {
      gateMsg.textContent = state.closed ? "✔ Ruta cerrada. Entrega tu constancia a tu docente." : "Para cerrar: completa «¿Qué aprendiste?» y descarga tu constancia.";
    } else {
      gateMsg.textContent = g ? "Para continuar: " + g : "✔ Etapa completa: ya puedes avanzar.";
    }
    gateMsg.className = "gate" + ((!g && n < TOTAL_STEPS) || state.closed ? " gate--ok" : "");
    prevBtn.disabled = n === 1;
    nextBtn.disabled = n === TOTAL_STEPS || !!g;
  }

  function showStep(n, silent) {
    n = Math.min(n, maxStep());
    for (var i = 1; i <= TOTAL_STEPS; i++) document.getElementById("step-" + i).classList.toggle("is-active", i === n);
    if (!silent) logEvent("NAVEGACION", "Entró a la Etapa " + n + " — " + STEP_NAMES[n]);
    state.step = n;
    if (n === 3) updateCasosStatus();
    if (n === 4) renderEvidence();
    if (n === 5) { renderFeedback(); renderRubric(); }
    if (n === 6) renderClose();
    refreshNav();
    window.scrollTo(0, 0);
    saveState();
  }

  function goTo(n) {
    if (n > state.step && gate(state.step)) { refreshNav(); return; }
    if (n > maxStep()) { refreshNav(); return; }
    showStep(n);
  }

  /* --------------------------------------------------------------------
     Etapa 2: verificación inmediata
     -------------------------------------------------------------------- */
  function showCheck(el) {
    var box = el.closest("fieldset").querySelector(".quiz__feedback");
    var ok = el.hasAttribute("data-correct");
    box.innerHTML = '<div class="result__box ' + (ok ? "ok" : "fail") + '"><span class="result__label">' + (ok ? "✔ Correcto" : "✘ Revisa") + "</span>" + escapeHtml(el.getAttribute("data-msg")) + "</div>";
  }

  /* --------------------------------------------------------------------
     Etapa 4: evidencia y entrega
     -------------------------------------------------------------------- */
  function renderEvidence() {
    [1, 2, 3].forEach(function (c) {
      var cs = state.cases[c];
      document.getElementById("evsum" + c).textContent = cs.executed
        ? "Tu último intento — entrada: " + caseInputText(cs) + ". Resultado: " + (cs.ok ? "sin falla detectada" : "falla reproducida") + "."
        : "Aún no practicaste este caso (Etapa 3).";
    });
    document.getElementById("deliverCheck").innerHTML = evidenceChecklist().map(function (i) {
      return "<li>" + (i[0] ? "✔ " : "○ ") + escapeHtml(i[1]) + "</li>";
    }).join("");
    var d = state.delivered;
    document.getElementById("deliverStatus").textContent = d
      ? "✔ Entrega " + d.n + " registrada el " + fmtDateTime(d.t) + " · código " + d.code + ". Entrega el PDF a tu docente."
      : "";
    document.getElementById("deliverBtn").textContent = d ? "⬇ Descargar de nuevo el PDF" : "⬇ Entregar evidencia (PDF)";
    document.getElementById("reopenBtn").hidden = !d;
    document.querySelectorAll("#step-4 [data-path]").forEach(function (el) { el.disabled = !!d; });
  }

  function evCode() { return checksum(JSON.stringify({ s: state.student, c: state.cases, r: state.report })); }

  function deliver() {
    if (state.delivered) { savePdf(composePdf(state.delivered.code, state.delivered.t, false), "evidencia-agendapp-", state.delivered.code); return; }
    var miss = evidenceChecklist().filter(function (i) { return !i[0]; }).map(function (i) { return i[1]; });
    if (miss.length) { alert("Antes de entregar completa:\n- " + miss.join("\n- ")); return; }
    var now = Date.now(), code = evCode();
    state.deliveries = (state.deliveries || 0) + 1;
    state.delivered = { n: state.deliveries, t: now, code: code };
    logEvent("ENTREGA", "Entregó su evidencia (entrega " + state.deliveries + "). Código " + code + ".");
    saveState(); renderEvidence(); refreshNav();
    savePdf(composePdf(code, now, false), "evidencia-agendapp-", code);
  }

  function reopen() {
    if (!state.delivered) return;
    if (!confirm("Se reabrirá tu entrega para que la mejores. Tendrás que volver a entregarla y a responder la autoevaluación de la Etapa 5. ¿Continuar?")) return;
    state.delivered = null;
    state.fb = { 1: "", 2: "", 3: "", ajuste: state.fb.ajuste };
    logEvent("ENTREGA", "Reabrió su entrega para mejorarla.");
    restoreUI(); saveState(); showStep(4, true);
  }

  /* --------------------------------------------------------------------
     Etapa 5: retroalimentación, comprobación y rúbrica
     -------------------------------------------------------------------- */
  function renderFeedback() {
    [1, 2, 3].forEach(function (c) {
      var cs = state.cases[c], r = state.report[c], ok = r.tipo === TIPOS[c];
      document.getElementById("fbtext" + c).innerHTML =
        "<p><strong>Falla:</strong> " + (cs.ok === false ? "la reprodujiste" : "no la reprodujiste en tu último intento") + " (intentos: " + (cs.attempts || 0) + ").</p>" +
        "<p><strong>Tipo que indicaste:</strong> " + escapeHtml(r.tipo || "(sin indicar)") + ' <span class="badge ' + (ok ? 'badge--ok">✔ Correcto' : 'badge--fail">✘ Era ' + TIPOS[c]) + "</span></p>" +
        "<p><strong>Tu explicación:</strong> " + escapeHtml(r.causa) + "</p>" +
        '<div class="result__box ok"><span class="result__label">Causa esperada</span>' + escapeHtml(QUIZ_TEXT["h" + c].why) + "</div>" +
        "<p><strong>Qué corregir y qué aprendes:</strong> " + escapeHtml(caseFeedback(c)) + "</p>";
    });
  }

  function renderQuizFeedback() {
    QUESTIONS.forEach(function (q) {
      var fs = document.querySelector('fieldset[data-q="' + q + '"]'), fb = fs.querySelector(".quiz__feedback");
      if (!fb) { fb = document.createElement("div"); fb.className = "quiz__feedback"; fs.appendChild(fb); }
      var ok = isCorrect(q), t = QUIZ_TEXT[q], ch = state.quiz[q], info = QUIZ_INFO[q];
      fb.innerHTML = '<div class="result__box ' + (ok ? "ok" : "fail") + '"><span class="result__label">' + (ok ? "✔ Correcta" : "✘ Incorrecta") + "</span>" +
        (ok ? "" : "<p><strong>Respuesta correcta:</strong> " + escapeHtml(info.options[info.correct]) + "</p>" +
          (t.wrong[ch] ? "<p><strong>Por qué tu opción no era correcta:</strong> " + escapeHtml(t.wrong[ch]) + "</p>" : "")) +
        "<p><strong>" + (ok ? "Por qué es correcta:" : "Explicación:") + "</strong> " + escapeHtml(t.why) + "</p></div>";
      fs.querySelectorAll("input").forEach(function (i) { i.disabled = true; });
    });
  }

  function checkQuiz() {
    var left = QUESTIONS.filter(function (q) { return !state.quiz[q]; }).length;
    if (left) { alert("Te faltan " + left + " pregunta(s) por responder."); return; }
    state.quizDone = true;
    logEvent("TEST", "Comprobó sus respuestas: " + QUESTIONS.filter(isCorrect).length + "/" + QUESTIONS.length + " correctas.");
    renderQuizFeedback(); renderRubric(); saveState(); refreshNav();
  }

  function rubricData() {
    var ex = 0, ti = 0, ca = 0, qz = QUESTIONS.filter(isCorrect).length;
    [1, 2, 3].forEach(function (c) {
      if (state.cases[c].executed && !state.cases[c].ok) ex++;
      if (state.report[c].tipo === TIPOS[c]) ti++;
      ca += { si: 1, parte: 0.5 }[state.fb[c]] || 0;
    });
    var rows = [
      ["Reproducir fallas", ex / 3, ex + " de 3", "Repite el caso con datos que revelen la falla (usa la pista)."],
      ["Identificar el tipo de falla", ti / 3, ti + " de 3", "Repasa los tres tipos de reporte en el RED (Etapa 2)."],
      ["Explicar la causa", ca / 3, ca + " de 3", "Compara tu explicación con la causa esperada y reescríbela."],
      ["Comprender conceptos", qz / QUESTIONS.length, qz + " de " + QUESTIONS.length, "Relee la explicación de las preguntas falladas."]
    ];
    var avg = rows.reduce(function (a, r) { return a + r[1]; }, 0) / rows.length;
    return { rows: rows, avg: avg, level: level(avg) };
  }
  function level(p) { return p >= 0.85 ? "Destacado" : p >= 0.65 ? "Logrado" : p >= 0.4 ? "En proceso" : "Inicial"; }

  function renderRubric() {
    var box = document.getElementById("rubricBox");
    if (!state.quizDone) { box.innerHTML = '<p class="summary__empty">Comprueba tus respuestas para ver tu nivel.</p>'; return; }
    var r = rubricData();
    box.innerHTML = "<p><strong>Nivel general: " + r.level + "</strong></p>" +
      '<table class="rubric"><tbody>' + r.rows.map(function (x) {
        return "<tr><th scope=\"row\">" + x[0] + "</th><td>" + x[2] + "</td><td>" + level(x[1]) + "</td><td>" + (x[1] < 1 ? x[3] : "¡Muy bien!") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* --------------------------------------------------------------------
     Etapa 6: cierre
     -------------------------------------------------------------------- */
  function renderClose() {
    var d = state.delivered, r = state.quizDone ? rubricData() : null;
    document.getElementById("summaryBox").innerHTML =
      "<p><strong>Evidencia:</strong> " + (d ? "entrega " + d.n + " el " + fmtDateTime(d.t) : "sin entregar") + "</p>" +
      "<p><strong>Nivel de desempeño:</strong> " + (r ? r.level : "pendiente") + "</p>" +
      "<p><strong>Tu plan de mejora:</strong> " + escapeHtml(state.fb.ajuste) + "</p>";
  }

  function downloadFinal() {
    if (!len(state.student.aprendizaje)) { alert("Antes de descargar, cuéntanos qué aprendiste."); document.getElementById("st-aprendizaje").focus(); return; }
    state.closed = true;
    logEvent("SISTEMA", "Cerró la ruta y descargó su constancia.");
    saveState(); refreshNav();
    var code = checksum(JSON.stringify({ s: state.student, c: state.cases, r: state.report, f: state.fb, q: state.quiz, l: state.log }));
    savePdf(composePdf(code, Date.now(), true), "constancia-agendapp-", code);
  }

  /* --------------------------------------------------------------------
     PDF: evidencia (Etapa 4) y constancia final (Etapa 6)
     -------------------------------------------------------------------- */
  function composePdf(code, now, final) {
    var L = PdfLayout(), st = state.student;
    function val(v) { return (v && String(v).trim()) || "(no indicado)"; }

    L.text(final ? "CONSTANCIA DE APRENDIZAJE - CIERRE DEL PROCESO" : "EVIDENCIA ENTREGADA - INFORME DE PRUEBAS", { size: 15, bold: true, color: C_BLUE });
    L.text("AgendApp Escolar - Ruta de aprendizaje: aprendo a probar software (RED-89-S-19)", { size: 10 });
    L.rule();
    L.heading("1. DATOS DEL ESTUDIANTE");
    L.text("Nombre completo: " + val(st.nombre));
    L.text("Documento de identidad: " + val(st.documento));
    L.text("Grado / curso: " + val(st.grado));
    L.text("Institución: " + val(st.institucion));
    L.text("Docente: " + val(st.docente));
    L.text("Inicio: " + fmtDateTime(state.startedAt) + "  |  Generado: " + fmtDateTime(now) + "  |  Duración: " + fmtDuration(now - state.startedAt));
    if (state.delivered) L.text("Entrega " + state.delivered.n + ": " + fmtDateTime(state.delivered.t));
    L.text("Código de control: " + code, { bold: true });

    L.heading("2. EVIDENCIA: CASOS PRACTICADOS E INFORME");
    [1, 2, 3].forEach(function (c) {
      var cs = state.cases[c], r = state.report[c];
      L.keep(90);
      L.text(caseTitles[c], { bold: true, size: 10, before: 6 });
      (cs.history || []).forEach(function (h) {
        L.keep(60);
        L.text("Intento " + h.n + " (" + fmtClock(h.t) + ") Entrada: " + caseInputText(h), { indent: 10, before: 3 });
        L.text("Esperado (predicción): " + h.esperado, { indent: 20 });
        L.text("Obtenido: " + h.obtenido, { indent: 20 });
        L.text(h.ok ? "[OK] Sin falla detectada" : "[X] Falla reproducida", { indent: 20, bold: true, color: h.ok ? C_GRAY : C_GREEN });
      });
      L.text("Tipo de falla indicado: " + val(r.tipo), { indent: 10, before: 3, bold: true });
      L.text("Causa propuesta: " + val(r.causa), { indent: 10 });
    });

    if (final) {
      var rd = state.quizDone ? rubricData() : null;
      L.heading("3. RETROALIMENTACIÓN Y NIVEL DE DESEMPEÑO");
      if (rd) {
        L.text("Nivel general: " + rd.level, { bold: true, color: C_BLUE });
        rd.rows.forEach(function (x) { L.text(x[0] + ": " + x[2] + " - " + level(x[1]) + (x[1] < 1 ? ". Para mejorar: " + x[3] : ""), { indent: 10 }); });
      }
      [1, 2, 3].forEach(function (c) {
        L.text("Caso " + c + " - causa esperada: " + QUIZ_TEXT["h" + c].why, { indent: 10, before: 4, color: C_BLUE });
        L.text("Comparación del estudiante con la causa esperada: " + ({ si: "coincide", parte: "coincide en parte", no: "no coincide" }[state.fb[c]] || "(sin indicar)"), { indent: 10 });
      });
      L.text("Plan de mejora del estudiante: " + val(state.fb.ajuste), { before: 4, bold: true });
      L.text("Comprobación de conceptos:", { bold: true, before: 6 });
      QUESTIONS.forEach(function (q, i) {
        L.keep(40);
        L.text((i + 1) + ". " + QUIZ_INFO[q].prompt + "  " + (isCorrect(q) ? "[OK]" : "[X]"), { indent: 10, color: isCorrect(q) ? C_GREEN : C_RED });
        if (!isCorrect(q)) L.text("Correcta: " + QUIZ_INFO[q].options[QUIZ_INFO[q].correct], { indent: 20 });
      });

      L.heading("4. AUTOEVALUACIÓN DEL ESTUDIANTE");
      L.text("Reporte más grave y por qué: " + val(st.reflexion));
      L.text("Qué aprendió: " + val(st.aprendizaje));
      L.text("Lo más difícil: " + val(st.dificultad));
      L.text("Valoración: " + val(st.valoracion));
      L.text("Comentarios: " + val(st.comentario));

      L.heading("5. REGISTRO DE ACTIVIDAD");
      state.log.forEach(function (e, i) {
        var d = new Date(e.t);
        L.text((i + 1) + ". [" + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " " + fmtClock(e.t) + "] " + e.c + ": " + e.x, { size: 8, after: 1 });
      });
    }
    L.rule();
    L.text("Documento generado localmente en el navegador del estudiante. El código de control resume el contenido para facilitar su verificación.", { size: 8, color: C_GRAY });
    L.text("Elaborado por Héctor Cogollo Ríos, con apoyo técnico de Claude (Anthropic).", { size: 8, color: C_GRAY });
    return L.pages;
  }

  function savePdf(pages, prefix, code) {
    var bytes = buildPdfBytes(pages, "AgendApp - " + truncate(state.student.nombre, 30) + " - " + code);
    var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    var a = document.createElement("a");
    a.href = url; a.download = prefix + (slug(state.student.nombre) || "estudiante") + ".pdf";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* --------------------------------------------------------------------
     Restaurar interfaz e inicializar
     -------------------------------------------------------------------- */
  function restoreUI() {
    [1, 2, 3].forEach(function (c) {
      var cs = state.cases[c];
      if (cs.executed) {
        document.getElementById("c" + c + "-esperado").value = cs.esperado;
        if (cs.sala) document.getElementById("c" + c + "-sala").value = cs.sala;
        if (cs.inicio) document.getElementById("c" + c + "-inicio").value = cs.inicio;
        if (cs.fin) document.getElementById("c" + c + "-fin").value = cs.fin;
        renderResult(c, cs.ok, cs.obtenido);
      }
    });
    updateCasosStatus();
    document.querySelectorAll("[data-path]").forEach(function (el) {
      var v = getPath(el.getAttribute("data-path"));
      if (el.type === "radio") { el.checked = v === el.value; if (el.checked && el.hasAttribute("data-msg")) showCheck(el); }
      else if (el.type === "checkbox") el.checked = !!v;
      else el.value = v || "";
    });
    document.querySelectorAll("details.report").forEach(function (d, i) { if (state.opened.indexOf(i + 1) > -1) d.open = true; });
    if (state.quizDone) renderQuizFeedback();
  }

  function init() {
    gateMsg = document.getElementById("gateMsg");
    nextBtn = document.getElementById("nextBtn");
    prevBtn = document.getElementById("prevBtn");

    document.querySelectorAll("fieldset[data-q]").forEach(function (fs) {
      var q = fs.getAttribute("data-q");
      QUESTIONS.push(q);
      QUIZ_INFO[q] = readQuizInfo(q);
    });

    document.querySelectorAll("[data-goto]").forEach(function (el) {
      el.addEventListener("click", function () { goTo(parseInt(el.getAttribute("data-goto"), 10)); });
    });
    document.querySelectorAll("[data-run]").forEach(function (el) {
      el.addEventListener("click", function () { runCase(parseInt(el.getAttribute("data-run"), 10)); });
    });
    document.querySelectorAll("details.report").forEach(function (d, i) {
      d.addEventListener("toggle", function () {
        if (d.open && state.opened.indexOf(i + 1) === -1) {
          state.opened.push(i + 1);
          logEvent("RED", "Leyó el Reporte " + (i + 1) + ".");
          saveState(); refreshNav();
        }
      });
    });
    document.querySelectorAll("[data-path]").forEach(function (el) {
      var evt = el.type === "radio" || el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, function () {
        setPath(el.getAttribute("data-path"), el.type === "checkbox" ? el.checked : el.value);
        if (el.hasAttribute("data-msg")) { showCheck(el); logEvent("RED", "Respondió una verificación: " + (el.hasAttribute("data-correct") ? "correcta" : "incorrecta") + "."); }
        saveState(); refreshNav();
        if (state.step === 4) renderEvidence();
      });
    });

    prevBtn.addEventListener("click", function () { if (state.step > 1) goTo(state.step - 1); });
    nextBtn.addEventListener("click", function () { goTo(state.step + 1); });
    document.getElementById("deliverBtn").addEventListener("click", deliver);
    document.getElementById("reopenBtn").addEventListener("click", reopen);
    document.getElementById("improveBtn").addEventListener("click", reopen);
    document.getElementById("quizBtn").addEventListener("click", checkQuiz);
    document.getElementById("downloadBtn").addEventListener("click", downloadFinal);
    document.getElementById("resetBtn").addEventListener("click", function () {
      if (confirm("Esto borrará todo tu avance guardado en este navegador. ¿Continuar?")) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* sin almacenamiento */ }
        window.location.reload();
      }
    });

    restoreUI();
    if (state.log.length === 0) logEvent("SISTEMA", "Inicio de la ruta de aprendizaje.");
    showStep(state.step || 1, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
