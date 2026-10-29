
window.XB_ADMIN = (function () {
  "use strict";

  var D = window.XB_DATA;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var LS = {
    get: function (k, d) {
      try { var v = localStorage.getItem("xb_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem("xb_" + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem("xb_" + k); } catch (e) {} }
  };

  var ADMIN = { works: [], events: [], members: [], issues: [], source: "local", cloud: false, user: null };
  var editingWorkId = null;
  var editingWorkCloud = false;
  var editingWorkSlug = "";
  var dirtyKeys = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(m, t) {
    var e = $("#toastEl");
    if (!e) return;
    e.textContent = m;
    e.className = "toast toast-" + (t || "ok") + " show";
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.classList.remove("show"); }, 2200);
  }
  function on(sel, ev, fn) { var el = $(sel); if (el) el.addEventListener(ev, fn); }

  function overlay() {
    var ov = LS.get("overlay", null);
    if (!ov) ov = { useLocal: false, works: {}, deletedWorks: [], events: null, members: null, journal: null };
    return ov;
  }
  function saveOverlay(ov) { LS.set("overlay", ov); }

  function localCorpus() {
    var corpus = {};
    D.works.forEach(function (w) { corpus[w.title] = w; });
    return corpus;
  }

  function hydrateContent(row, corpus) {
    var local = corpus[row.slug] || corpus[row.title];
    var content = (row.content && row.content.length) ? row.content : (local ? local.content : null);
    return content && content.length ? content : ["（正文待补充）"];
  }

  function applyLocalOverlay(list, key) {
    var ov = overlay();
    if (key) return ov[key] ? ov[key] : list.slice();
    var del = ov.deletedWorks || [];
    var arr = list.filter(function (w) { return del.indexOf(w.id) < 0; }).map(function (w) {
      return (ov.works && ov.works[w.id]) || w;
    });
    if (ov.works) Object.keys(ov.works).forEach(function (k) { if (ov.works[k]._new) arr.push(ov.works[k]); });
    return arr;
  }

  function loadData() {
    if (!window.XB_CLOUD) {
      fallbackLocal();
      return Promise.resolve(false);
    }
    return XB_CLOUD.load().then(function () {
      return XB_CLOUD.session().then(function (s) {
        if (s && s.user) {
          var allow = (window.XB_CONFIG && window.XB_CONFIG.adminEmails) || [];
          var mail = (s.user.email || "").toLowerCase();
          if (allow.length && mail && allow.indexOf(mail) < 0) {
            ADMIN.denied = true;
            XB_CLOUD.signOut();
          } else { ADMIN.cloud = true; ADMIN.user = s.user; }
        }
      });
    }).then(function () {
      return Promise.all([
        XB_CLOUD.fetchWorks(),
        XB_CLOUD.fetchContent("event"),
        XB_CLOUD.fetchContent("member"),
        XB_CLOUD.fetchContent("issue"),
        XB_CLOUD.fetchContent("recruit"),
        XB_CLOUD.fetchSubmissions()
      ]);
    }).then(function (res) {
      var corpus = localCorpus();
      var works = res[0], events = res[1], members = res[2], issues = res[3], recruits = res[4];
      ADMIN.recruits = recruits || [];
      ADMIN.subs = ((res[5] || []).filter(function (r) { return r.category !== "application"; })) || [];
      if (works && works.length) {
        ADMIN.works = works.map(function (row) {
          return {
            cloud_id: row.id,
            id: row.id,
            slug: row.slug || row.title,
            title: row.title,
            author: row.author,
            grade: row.grade || "",
            class_name: row.class_name || "",
            category: row.category || "essay",
            excerpt: row.excerpt || "",
            content: hydrateContent(row, corpus),
            likes: row.likes || 0,
            bookmarks: row.bookmarks || 0
          };
        });
      } else {
        ADMIN.works = applyLocalOverlay(D.works);
      }
      if (events) {
        ADMIN.events = events.map(function (r) {
          var b = r.body || {};
          return { slug: r.slug, title: r.title || b.title || "活动", days: b.days || 14, time: b.time || "18:00-20:00", loc: b.loc || "待定", desc: b.desc || "" };
        });
      } else {
        ADMIN.events = applyLocalOverlay(D.events, "events");
      }
      if (members) {
        ADMIN.members = members.map(function (r) {
          var b = r.body || {};
          return { slug: r.slug, name: r.title || b.name || "社员", role: b.role || "社员", quote: b.quote || "", bio: b.bio || "", hue: b.hue || "#8b3a3a" };
        });
      } else {
        ADMIN.members = applyLocalOverlay(D.members, "members");
      }
      if (issues) ADMIN.issues = issues.map(function (r) { return r.body || {}; });
      else ADMIN.issues = applyLocalOverlay(D.journal.issues, "journal");
      ADMIN.source = (works || events || members || issues) ? "cloud" : "local";
      return true;
    }).catch(function () {
      fallbackLocal();
      return false;
    });
  }

  function fallbackLocal() {
    ADMIN.works = applyLocalOverlay(D.works);
    ADMIN.events = applyLocalOverlay(D.events, "events");
    ADMIN.members = applyLocalOverlay(D.members, "members");
    ADMIN.issues = applyLocalOverlay(D.journal.issues, "journal");
    ADMIN.source = "local";
  }

  function renderWorks() {
    var list = ADMIN.works;
    $("#wkCount").textContent = "共 " + list.length + " 篇";
    var html = "";
    list.forEach(function (w, i) {
      html += "<tr>" +
        "<td>" + (i + 1) + "</td>" +
        "<td><strong>" + esc(w.title) + "</strong></td>" +
        "<td>" + esc(w.author) + "</td>" +
        "<td>" + esc(w.grade || "") + (w.class_name ? esc(w.class_name) + "班" : "") + "</td>" +
        "<td>" + esc(D.categories[w.category] || w.category) + "</td>" +
        "<td>" + (w.cloud_id ? "云端" : "本机") + "</td>" +
        "<td class='ad-ops'>" +
        "<button class='ad-mini' data-edit='" + esc(String(w.cloud_id || w.id)) + "'>编辑</button>" +
        "<button class='ad-mini danger' data-del='" + esc(String(w.cloud_id || w.id)) + "'>删除</button>" +
        "</td></tr>";
    });
    $("#wkRows").innerHTML = html || "<tr><td colspan='7' class='ad-empty'>暂无作品，点击“新增作品”开始</td></tr>";
    $$("#wkRows [data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openWorkEditor(b.dataset.edit); });
    });
    $$("#wkRows [data-del]").forEach(function (b) {
      b.addEventListener("click", function () { deleteWork(b.dataset.del); });
    });
  }

  function findWork(key) {
    for (var i = 0; i < ADMIN.works.length; i++) {
      if (String(ADMIN.works[i].cloud_id || ADMIN.works[i].id) === String(key)) return ADMIN.works[i];
    }
    return null;
  }

  function openWorkEditor(key) {
    var w = key ? findWork(key) : null;
    editingWorkId = w ? (w.cloud_id || w.id) : null;
    editingWorkCloud = w ? !!w.cloud_id : false;
    editingWorkSlug = w ? (w.slug || w.title) : "";
    $("#weTitle").value = w ? w.title : "";
    $("#weAuthor").value = w ? w.author : "";
    $("#weGrade").value = w ? (w.grade || "") : "";
    $("#weClass").value = w ? (w.class_name || "") : "";
    $("#weCat").value = w ? w.category : "prose";
    $("#weExcerpt").value = w ? (w.excerpt || "") : "";
    $("#weContent").value = w ? (w.content || []).join("\n\n") : "";
    $("#weIdLabel").textContent = w ? ("正在编辑：《" + w.title + "》") : "新增作品";
    $("#workEditor").classList.add("open");
  }

  function saveWorkEditor() {
    var title = $("#weTitle").value.trim();
    var author = $("#weAuthor").value.trim();
    if (!title || !author) { toast("标题和作者不能为空", "err"); return; }
    var content = $("#weContent").value.split(/\r?\n\s*\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var payload = {
      slug: editingWorkSlug || title,
      title: title,
      author: author,
      grade: $("#weGrade").value.trim(),
      class_name: $("#weClass").value.trim(),
      category: $("#weCat").value,
      excerpt: $("#weExcerpt").value.trim() || (content[0] || "").slice(0, 80),
      content: content.length ? content : ["（正文待补充）"]
    };
    $("#workEditor").classList.remove("open");

    var ov = overlay();
    ov.useLocal = true;
    if (!ov.works) ov.works = {};
    if (!ov.deletedWorks) ov.deletedWorks = [];
    var localId = editingWorkCloud ? editingWorkId : (Date.now());
    var localRow = {
      id: localId,
      title: payload.title, author: payload.author, grade: payload.grade, class_name: payload.class_name,
      category: payload.category, excerpt: payload.excerpt, content: payload.content,
      likes: 0, bookmarks: 0, slug: payload.slug
    };
    if (!editingWorkCloud) localRow._new = true;
    ov.works[localId] = localRow;
    saveOverlay(ov);

    if (ADMIN.cloud && window.XB_CLOUD) {
      XB_CLOUD.saveWork({
        id: editingWorkCloud ? editingWorkId : null,
        slug: payload.slug, title: payload.title, author: payload.author,
        grade: payload.grade, class_name: payload.class_name,
        category: payload.category, excerpt: payload.excerpt, content: payload.content
      }).then(function (r) {
        if (r && r.error) { toast("云端保存失败：已存为本机草稿", "err"); return; }
        toast("已保存到云端作品库，全站可见");
        return loadData().then(function () { renderAll(); updateModeLabel(); });
      }).catch(function () { toast("云端保存失败：已存为本机草稿", "err"); });
    } else {
      toast("已保存为本机草稿（登录后同步到云端）");
    }
    renderWorks();
    updateModeLabel();
  }

  function deleteWork(key) {
    if (!confirm("确定删除这篇作品吗？")) return;
    var w = findWork(key);
    if (!w) return;
    var ov = overlay();
    ov.useLocal = true;
    if (!ov.works) ov.works = {};
    if (!ov.deletedWorks) ov.deletedWorks = [];
    delete ov.works[w.cloud_id || w.id];
    if (ov.deletedWorks.indexOf(w.cloud_id || w.id) < 0) ov.deletedWorks.push(w.cloud_id || w.id);
    saveOverlay(ov);
    if (ADMIN.cloud && w.cloud_id && window.XB_CLOUD) {
      XB_CLOUD.deleteWork(w.cloud_id).then(function (r) {
        if (r && r.error) { toast("云端删除失败：本机已移除", "err"); return; }
        toast("已从云端作品库删除");
      }).catch(function () { toast("云端删除失败：本机已移除", "err"); });
    } else {
      toast("已从本机移除");
    }
    renderWorks();
    updateModeLabel();
  }

  function renderEvents() {
    var list = ADMIN.events;
    $("#evCount").textContent = "共 " + list.length + " 项";
    $("#evRows").innerHTML = list.map(function (ev, i) {
      return "<div class='ad-item' data-i='" + i + "'>" +
        "<div class='ad-item-head'><strong>" + esc(ev.title) + "</strong><button class='ad-mini danger' data-evdel='" + i + "'>删除</button></div>" +
        "<div class='ad-grid2'>" +
        "<label>名称<input data-ev='title' value='" + esc(ev.title) + "'></label>" +
        "<label>距今天数<input data-ev='days' type='number' value='" + ev.days + "'></label>" +
        "<label>时间<input data-ev='time' value='" + esc(ev.time) + "'></label>" +
        "<label>地点<input data-ev='loc' value='" + esc(ev.loc) + "'></label>" +
        "</div>" +
        "<label>简介<textarea data-ev='desc' rows='2'>" + esc(ev.desc) + "</textarea></label>" +
        "</div>";
    }).join("");
    bindSection("ev");
  }

  function renderMembers() {
    var list = ADMIN.members;
    $("#mbCount").textContent = "共 " + list.length + " 人";
    $("#mbRows").innerHTML = list.map(function (m, i) {
      return "<div class='ad-item' data-i='" + i + "'>" +
        "<div class='ad-item-head'><strong>" + esc(m.name) + "</strong><button class='ad-mini danger' data-mbdel='" + i + "'>删除</button></div>" +
        "<div class='ad-grid2'>" +
        "<label>姓名<input data-mb='name' value='" + esc(m.name) + "'></label>" +
        "<label>职务<input data-mb='role' value='" + esc(m.role) + "'></label>" +
        "<label>寄语<input data-mb='quote' value='" + esc(m.quote) + "'></label>" +
        "<label>简介<input data-mb='bio' value='" + esc(m.bio) + "'></label>" +
        "<label>主题色<input data-mb='hue' type='color' value='" + esc(m.hue || "#8b3a3a") + "'></label>" +
        "</div></div>";
    }).join("");
    bindSection("mb");
  }

  function renderJournal() {
    var list = ADMIN.issues;
    $("#jrCount").textContent = "共 " + list.length + " 期";
    $("#jrRows").innerHTML = list.map(function (is, i) {
      var pieces = (is.pieces || []).map(function (p) {
        return [p.title, p.author, p.type, p.page].join("|");
      }).join("\n");
      return "<div class='ad-item' data-i='" + i + "'>" +
        "<div class='ad-item-head'><strong>第" + is.no + "期 · " + esc(is.theme) + "</strong><button class='ad-mini danger' data-jrdel='" + i + "'>删除</button></div>" +
        "<div class='ad-grid2'>" +
        "<label>期号<input data-jr='no' type='number' value='" + is.no + "'></label>" +
        "<label>年份<input data-jr='year' type='number' value='" + is.year + "'></label>" +
        "<label>季节<input data-jr='term' value='" + esc(is.term) + "'></label>" +
        "<label>主题<input data-jr='theme' value='" + esc(is.theme) + "'></label>" +
        "<label>日期<input data-jr='date' value='" + esc(is.date) + "'></label>" +
        "</div>" +
        "<label>篇目（每行一条：标题|作者|类型|页码）<textarea data-jr='pieces' rows='3'>" + esc(pieces) + "</textarea></label>" +
        "</div>";
    }).join("");
    bindSection("jr");
  }

  function markDirty(key) {
    if (dirtyKeys[key]) return;
    dirtyKeys[key] = true;
    var b = $("#" + key + "Save");
    if (b) b.textContent = b.textContent.replace("保存", "保存 ●");
  }
  function clearDirty(key) {
    delete dirtyKeys[key];
    var b = $("#" + key + "Save");
    if (b) b.textContent = b.textContent.replace(" ●", "");
  }

  function bindSection(key) {
    $$("#" + key + "Rows [data-" + key + "]").forEach(function (el) {
      el.addEventListener("input", function () { markDirty(key); });
    });
    $$("#" + key + "Rows [data-" + key + "del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = parseInt(b.dataset[key + "del"], 10);
        var list = currentList(key).filter(function (_, idx) { return idx !== i; });
        writeSection(key, list);
        renderSection(key);
        toast("已删除");
      });
    });
  }

  function currentList(key) {
    if (key === "ev") return ADMIN.events.slice();
    if (key === "mb") return ADMIN.members.slice();
    return ADMIN.issues.slice();
  }
  function renderSection(key) {
    if (key === "ev") renderEvents();
    else if (key === "mb") renderMembers();
    else renderJournal();
    updateModeLabel();
  }
  function writeSection(key, list) {
    var ov = overlay();
    ov.useLocal = true;
    if (key === "ev") ov.events = list;
    else if (key === "mb") ov.members = list;
    else ov.journal = list;
    saveOverlay(ov);
    if (key === "ev") ADMIN.events = list;
    else if (key === "mb") ADMIN.members = list;
    else ADMIN.issues = list;
  }

  function saveSection(key) {
    var items = currentList(key);
    $$("#" + key + "Rows .ad-item").forEach(function (box) {
      var i = parseInt(box.dataset.i, 10);
      var it = items[i];
      if (!it) return;
      $$("[data-" + key + "]", box).forEach(function (el) {
        var f = el.dataset[key];
        if (f === "pieces") {
          it.pieces = el.value.split("\n").map(function (line) {
            var p = line.split("|");
            return { title: (p[0] || "").trim(), author: (p[1] || "").trim(), type: (p[2] || "").trim(), page: (p[3] || "").trim() };
          }).filter(function (p) { return p.title; });
        } else if (f === "no" || f === "year" || f === "days") {
          it[f] = parseInt(el.value, 10) || 0;
        } else {
          it[f] = el.value;
        }
      });
    });
    writeSection(key, items);
    renderSection(key);
    clearDirty(key);

    if (ADMIN.cloud && window.XB_CLOUD) {
      var kind = key === "ev" ? "event" : key === "mb" ? "member" : "issue";
      var chain = Promise.resolve();
      items.forEach(function (it, idx) {
        chain = chain.then(function () {
          var slug = it.slug || (kind + "-" + (idx + 1));
          var title = kind === "event" ? it.title : kind === "member" ? it.name : ("第" + it.no + "期 " + it.theme);
          var body = kind === "event" ? { days: it.days, time: it.time, loc: it.loc, desc: it.desc }
            : kind === "member" ? { role: it.role, quote: it.quote, bio: it.bio, hue: it.hue, name: it.name }
            : it;
          return XB_CLOUD.saveContent(kind, slug, title, body, idx + 1);
        });
      });
      chain.then(function (r) {
        if (r && r.error) { toast("云端同步失败：已存为本机", "err"); return; }
        toast("已保存并同步到云端，全站可见");
      }).catch(function () { toast("云端同步失败：已存为本机", "err"); });
    } else {
      toast("已保存为本机草稿（登录后同步到云端）");
    }
  }

  function addSectionItem(key) {
    var list = currentList(key);
    if (key === "ev") list.push({ title: "新活动", days: 14, time: "18:00-20:00", loc: "待定", desc: "活动简介" });
    else if (key === "mb") list.push({ name: "新社员", role: "社员", quote: "一句话寄语", bio: "简介", hue: "#8b3a3a" });
    else list.push({ no: (list.length ? list[0].no + 1 : 48), year: new Date().getFullYear(), term: "春", theme: "新一期", date: new Date().getFullYear() + "年4月", pieces: [] });
    writeSection(key, list);
    renderSection(key);
    toast("已添加，向下滚动填写内容后保存");
  }

  function exportJSON() {
    var data = {
      _meta: { app: "xinbi-basic", exportedAt: new Date().toISOString(), source: ADMIN.source },
      works: ADMIN.works,
      events: ADMIN.events,
      members: ADMIN.members,
      journal: ADMIN.issues
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "xinbi-content-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出 JSON");
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.works)) throw new Error("bad");
        ADMIN.works = data.works;
        if (Array.isArray(data.events)) ADMIN.events = data.events;
        if (Array.isArray(data.members)) ADMIN.members = data.members;
        if (Array.isArray(data.journal)) ADMIN.issues = data.journal;
        renderAll();
        toast("已导入到本机草稿（登录后可同步到云端）");
      } catch (e) {
        toast("导入失败：文件格式不正确", "err");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("恢复默认将清空本机的所有草稿编辑（云端数据不受影响），确定吗？")) return;
    LS.del("overlay");
    loadData().then(function () { renderAll(); updateModeLabel(); toast("已恢复默认数据"); });
  }

  function renderRecords() {
    var box = $("#adRecords");
    if (!box) return;
    function paint(subs, apps) {
      var html = "<h4>云端投稿记录（" + subs.length + "）</h4>";
      html += subs.length ? subs.map(function (s) {
        return "<div class='ad-rec'><strong>" + esc(s.title || "无题") + "</strong> · " + esc(s.author || "") + " · " + esc(String(s.created_at || "").slice(0, 16)) + "</div>";
      }).join("") : "<p class='ad-empty'>暂无</p>";
      html += "<h4 style='margin-top:16px'>本机申请记录（" + apps.length + "）</h4>";
      html += apps.length ? apps.map(function (a) {
        return "<div class='ad-rec'><strong>" + esc(a.mName || "") + "</strong> · " + esc(a.mGrade || "") + " · " + esc(a._time || "") + "</div>";
      }).join("") : "<p class='ad-empty'>暂无</p>";
      box.innerHTML = html;
    }
    var localApps = LS.get("applications", []);
    if (window.XB_CLOUD && XB_CLOUD.isReady()) {
      XB_CLOUD.fetchSubmissions().then(function (rows) { paint(rows || [], localApps); })
        .catch(function () { paint([], localApps); });
    } else {
      paint([], localApps);
    }
  }

  function updateModeLabel() {
    var el = $("#adMode");
    if (el) {
      el.textContent = ADMIN.cloud
        ? "云端作品库（已登录，编辑全局共享）"
        : (ADMIN.source === "cloud" ? "云端作品库（只读，未登录）" : "未登录");
    }
    var dot = $("#adDot");
    if (dot) dot.className = "ad-dot" + (ADMIN.cloud ? " on" : ADMIN.source === "cloud" ? " warn" : "");
    var btn = $("#adModeToggle");
    if (btn) {
      btn.textContent = ADMIN.cloud ? "退出登录" : "去登录";
      btn.onclick = function () {
        if (ADMIN.cloud) {
          XB_CLOUD.signOut().then(function () {
            ADMIN.cloud = false;
            ADMIN.user = null;
            updateModeLabel();
            toast("已退出登录");
          });
        } else {
          location.href = "login.html?next=admin.html";
        }
      };
    }
  }

  function renderAll() {
    renderWorks();
    renderEvents();
    renderMembers();
    renderJournal();
    renderRecords();
    renderActs();
    renderRecruits();
    renderSubs();
    renderArchive();
  }

  function init() {
    var local = LS.get("user", null);
    var gate = $("#adGate");
    var app = $("#adApp");

    loadData().then(function () {
      if (ADMIN.cloud) {
        gate.style.display = "none";
        app.style.display = "block";
        var u = ADMIN.user || {};
        $("#adUserName").textContent = u.email || u.name || "社员";
      } else {
        var lg = gate.querySelector("h2");
        if (lg) lg.textContent = "后台需要登录";
        var lp = gate.querySelector("p");
        if (lp) lp.textContent = "访客无法进入后台。请使用管理员账号登录后继续。";
        gate.style.display = "grid";
        app.style.display = "none";
      }
      renderAll();
      updateModeLabel();
      bindUI();
    });
  }

  function bindUI() {
    $$(".ad-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        $$(".ad-tabs button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        $$(".ad-panel").forEach(function (p) { p.classList.remove("on"); });
        var t = $("#tab-" + b.dataset.tab);
        if (t) t.classList.add("on");
      });
    });
    on("#weNew", "click", function () { openWorkEditor(null); });
    on("#weSave", "click", saveWorkEditor);
    on("#weCancel", "click", function () { $("#workEditor").classList.remove("open"); });
    [["ev", "保存活动"], ["mb", "保存社员"], ["jr", "保存社刊"]].forEach(function (pair) {
      on("#" + pair[0] + "Save", "click", function () { saveSection(pair[0]); });
      on("#" + pair[0] + "Add", "click", function () { addSectionItem(pair[0]); });
    });
    on("#adExport", "click", exportJSON);
    on("#adImportBtn", "click", function () { $("#adImportFile").click(); });
    on("#adImportFile", "change", function () { if (this.files[0]) importJSON(this.files[0]); this.value = ""; });
    on("#adReset", "click", resetAll);
    on("#adClearInteractions", "click", function () {
      if (!confirm("清空本机的点赞/收藏/评论记录吗？")) return;
      LS.del("likes"); LS.del("bookmarks"); LS.del("comments");
      toast("互动数据已清空");
    });
    on("#adLogout", "click", function () {
      if (window.XB_CLOUD) XB_CLOUD.signOut().catch(function () {});
      LS.del("user");
      location.href = "index.html";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  var ACT = LS.get("activities", null);
  function actData() { return ACT || (window.XB_ACTIVITIES || []); }
  function renderActs() {
    var box = $("#acRows"), cnt = $("#acCount");
    if (!box) return;
    var list = actData();
    if (cnt) cnt.textContent = list.length + " 篇";
    box.innerHTML = list.map(function (a, i) {
      return '<div class="ev-row" style="border:1px solid var(--line-2);border-radius:8px;padding:14px;margin-bottom:12px">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">' +
        '<input class="f-in" data-i="' + i + '" data-f="date" value="' + esc(a.date) + '" placeholder="日期" style="width:110px">' +
        '<input class="f-in" data-i="' + i + '" data-f="title" value="' + esc(a.title) + '" placeholder="标题" style="flex:1;min-width:220px">' +
        '<input class="f-in" data-i="' + i + '" data-f="url" value="' + esc(a.url) + '" placeholder="原文链接" style="flex:1;min-width:220px">' +
        '</div><textarea class="f-in" data-i="' + i + '" data-f="text" rows="5" style="width:100%">' + esc((a.paras || []).join("\n\n")) + '</textarea></div>';
    }).join("");
    $$("#acRows .f-in").forEach(function (el) {
      el.addEventListener("change", function () {
        var i = +el.dataset.i, f = el.dataset.f, list2 = actData();
        if (f === "text") list2[i].paras = el.value.split("\n\n");
        else list2[i][f] = el.value;
        ACT = list2; LS.set("activities", list2);
      });
    });
  }
  function actExport() {
    var list = actData();
    var js = "/* 自动生成：美篇活动全文 */\nwindow.XB_ACTIVITIES = " + JSON.stringify(list, null, 2) + ";\n";
    var b = new Blob([js], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "activities.js"; a.click();
    toast("已导出 activities.js，替换后重新发布即可生效");
  }
  on("#acExport", "click", actExport);
  on("#acBackup", "click", function () {
    var b = new Blob([JSON.stringify({ activities: actData(), people: window.XB_PEOPLE || [] }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "xinbi-backup.json"; a.click();
  });


  /* ===== 招新申请 ===== */
  function renderRecruits() {
    var box = $("#rcRows"), cnt = $("#rcCount");
    if (!box) return;
    var list = ADMIN.recruits || [];
    if (cnt) cnt.textContent = list.length + " 份";
    if (!list.length) { box.innerHTML = '<p class="ad-sub">暂无申请。访客在「加入我们」提交后会出现在这里。</p>'; return; }
    box.innerHTML = list.map(function (r) {
      var b = r.body || {};
      return '<div style="border:1px solid var(--line-2);border-radius:8px;padding:14px;margin-bottom:12px">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">' +
        '<b>' + esc(b.mName || "匿名") + '</b><span style="color:var(--ink-3);font-size:.8rem">' + esc(b.mGrade || "") +
        (b._time ? " · " + esc(b._time) : "") + (b.processed ? " · 已处理" : "") + "</span></div>" +
        '<div style="font-size:.84rem;line-height:1.9;margin:6px 0">兴趣方向：' + esc(b.mInterest || "—") + "</div>" +
        '<div style="font-size:.84rem;line-height:1.9">联系：' + esc(b.mEmail || "—") + (b.mPhone ? " · " + esc(b.mPhone) : "") + "</div>" +
        '<div style="font-size:.84rem;line-height:1.9;color:var(--ink-2);margin-top:6px">' + esc(b.mMsg || "") + "</div>" +
        (b.processed ? "" : '<button class="btn btn-l sm" data-slug="' + esc(r.slug) + '" style="margin-top:10px">标记已处理</button>') +
        "</div>";
    }).join("");
    $$("#rcRows button[data-slug]").forEach(function (b) {
      b.addEventListener("click", function () {
        var slug = b.dataset.slug;
        var rec = (ADMIN.recruits || []).filter(function (x) { return x.slug === slug; })[0];
        if (!rec) return;
        var body = rec.body || {}; body.processed = true;
        XB_CLOUD.saveContent("recruit", slug, rec.title || (body.mName || "申请"), body, rec.sort || 0).then(function () { loadRecruits(); });
      });
    });
  }
  function loadRecruits() {
    return XB_CLOUD.fetchContent("recruit").then(function (rows) {
      ADMIN.recruits = rows || [];
      renderRecruits();
    });
  }
  on("#rcReload", "click", loadRecruits);
  on("#rcExport", "click", function () {
    var b = new Blob([JSON.stringify(ADMIN.recruits || [], null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "recruits.json"; a.click();
  });


  /* ===== 投稿审核 ===== */
  function renderSubs() {
    var box = $("#sbRows"), cnt = $("#sbCount");
    if (!box) return;
    var list = ADMIN.subs || [];
    if (cnt) cnt.textContent = list.length + " 条";
    if (!list.length) { box.innerHTML = '<p class="ad-sub">暂无投稿。访客提交后会出现在这里。</p>'; return; }
    var read = LS.get("subsRead", []);
    box.innerHTML = list.map(function (r) {
      var done = read.indexOf(r.id) > -1;
      return '<div style="border:1px solid var(--line-2);border-radius:8px;padding:14px;margin-bottom:12px' + (done ? ";opacity:.55" : "") + '">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">' +
        "<b>" + esc(r.title || "无题") + '</b><span style="color:var(--ink-3);font-size:.8rem">' + esc(r.author || "") +
        (r.grade ? " · " + esc(r.grade) : "") + (r.created_at ? " · " + esc(r.created_at.slice(0, 10)) : "") +
        (done ? " · 已读" : "") + "</span></div>" +
        '<div style="font-size:.84rem;line-height:1.9;color:var(--ink-2);margin:6px 0">' + esc(r.contact || "—") + "</div>" +
        '<div style="font-size:.84rem;line-height:1.9;white-space:pre-wrap">' + esc((r.content || "").slice(0, 300)) + "</div>" +
        (done ? "" : '<button class="btn btn-l sm" data-sid="' + esc(String(r.id)) + '" style="margin-top:10px">标记已读</button>') +
        "</div>";
    }).join("");
    $$("#sbRows button[data-sid]").forEach(function (b) {
      b.addEventListener("click", function () {
        var rd = LS.get("subsRead", []);
        if (rd.indexOf(b.dataset.sid) < 0) { rd.push(b.dataset.sid); LS.set("subsRead", rd); }
        renderSubs();
      });
    });
  }
  function loadSubs() {
    return XB_CLOUD.fetchSubmissions().then(function (rows) {
      ADMIN.subs = (rows || []).filter(function (r) { return r.category !== "application"; });
      renderSubs();
    });
  }
  on("#sbReload", "click", loadSubs);
  on("#sbExport", "click", function () {
    var list = ADMIN.subs || [];
    var rows = [["标题", "作者", "年级", "联系", "时间", "内容"]].concat(list.map(function (r) {
      return [r.title || "", r.author || "", r.grade || "", r.contact || "", r.created_at || "", (r.content || "").replace(/\n/g, " ")];
    }));
    var csv = "\ufeff" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var b = new Blob([csv], { type: "text/csv" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "submissions.csv"; a.click();
  });

  /* ===== 档案管理 ===== */
  function dl(name, text, mime) {
    var b = new Blob([text], { type: mime || "text/plain" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  }
  function renderArchive() {
    var box = $("#afSecRows");
    if (!box) return;
    var sec = D.site.sections || {};
    box.innerHTML = '<input class="f-in" id="afVer" style="width:100%" value="' + esc((sec.verified || []).map(function (x) { return x.name; }).join("、")) + '" placeholder="已证实版块，顿号分隔">' +
      '<input class="f-in" id="afPen" style="width:100%;margin-top:8px" value="' + esc(Array(sec.pending || 0).fill("待补").join("、")) + '" placeholder="待补版块，顿号分隔">';
    var pbox = $("#afPeoRows");
    if (pbox) pbox.innerHTML = (window.XB_PEOPLE || []).map(function (p2, i) {
      return '<div style="display:flex;gap:8px;margin-bottom:8px"><input class="f-in" data-pi="' + i + '" data-pf="name" value="' + esc(p2.name) + '" style="width:110px">' +
        '<input class="f-in" data-pi="' + i + '" data-pf="role" value="' + esc(p2.role) + '" style="width:150px">' +
        '<input class="f-in" data-pi="' + i + '" data-pf="note" value="' + esc(p2.note) + '" style="flex:1;min-width:200px"></div>';
    }).join("");
    $$("#afPeoRows .f-in").forEach(function (el) {
      el.addEventListener("change", function () {
        var list = window.XB_PEOPLE || [];
        list[+el.dataset.pi][el.dataset.pf] = el.value;
        LS.set("people", list);
      });
    });
  }
  on("#afPeople", "click", function () {
    var list = LS.get("people", null) || window.XB_PEOPLE || [];
    dl("people.js", "window.XB_PEOPLE = " + JSON.stringify(list, null, 2) + ";\n");
    toast("已导出 people.js，替换后重新发布生效");
  });
  on("#afCatalog", "click", function () {
    var rows = [["标题", "作者/出处", "说明"]].concat((D.site.catalog || []).map(function (c) {
      return [c.title || "", c.author || c.kind || "", c.where || ""];
    }));
    var csv = "\ufeff" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    dl("catalog.csv", csv, "text/csv");
  });
  on("#afSections", "click", function () {
    var ver = ($("#afVer") || {}).value || "";
    var pen = ($("#afPen") || {}).value || "";
    var out = { verified: ver.split("、").filter(Boolean).map(function (n) { return { name: n.trim(), note: "" }; }), total: 11, pending: pen.split("、").filter(Boolean).length, pendingNames: pen, source: "由后台编辑导出" };
    dl("sections.json", JSON.stringify(out, null, 2), "application/json");
  });

})();
