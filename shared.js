// shared.js — الحاجات المشتركة بين صفحات البوابة، في مكان واحد بدل ما تبقى متكررة في كل صفحة.
// أي موقع جديد أو تغيير في الإعدادات يتعمل هنا مرة واحدة.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ===== Firebase =====
export const firebaseConfig = {
  apiKey: "AIzaSyBscBbgFrEd76NjDgNPpymF1nmlvlpprdg",
  authDomain: "theama-salaries.firebaseapp.com",
  projectId: "theama-salaries",
  storageBucket: "theama-salaries.firebasestorage.app",
  messagingSenderId: "469549638177",
  appId: "1:469549638177:web:4e5c1d4c055108312cb960"
};
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ===== المواقع =====
// مواقع بوابة الحضور (كشوف مصورة) — لازم تفضل نفس القايمة اللي في firestore.rules (attSites) و worker.py (ATT_SITES)
export const ATT_SITES = ["فرع العامرية", "فرع العجمى", "مصنع العامرية", "دمنهور", "كفر الدوار", "المنصورة", "فرع طنطا", "طنطا مصنع"];
// المواقع اللي حضورها بيترفع إكسيل (upload.html) — للمكتب بس حالياً
export const XL_SITES = ["قطامية", "ابوصير", "العامرية امداد", "اكتوبر امداد", "مدينة نصر امداد", "طنطا امداد", "الشرقية للدخان"];
// المديرين الإقليميين: مش مكتوبين هنا (الريبو Public) — في firestore.rules (isRegional) وفي Firestore (config/regionals)

// ===== المخطط (شيت احتياج بيبسي) =====
const pnorm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const pkey = s => pnorm(s).toLowerCase();
const ckey = (loc, pos) => pnorm(loc) + "|" + pkey(pos);

// بيانات المخطط الساري لشهر: آخر شيت متسجل لحد الشهر ده + تعديلاته + جدول المطابقة.
// بيرجّع null لو مفيش شيت أو مفيش إعدادات.
export async function fetchPlanBase(month) {
  const plans = await getDocs(collection(db, "plans"));
  let pm = null, plan = null;
  plans.forEach(d => { if (d.id <= month && (!pm || d.id > pm)) { pm = d.id; plan = d.data(); } });
  if (!plan) return null;
  const [am, st] = await Promise.all([
    getDocs(query(collection(db, "plan_amendments"), where("month", "==", pm))),
    getDoc(doc(db, "plan_settings", "mapping"))
  ]);
  const amends = []; am.forEach(d => amends.push(d.data()));
  amends.sort((a, b) => a.effective_date.localeCompare(b.effective_date) || ((a.created_at?.seconds || 0) - (b.created_at?.seconds || 0)));
  const set = st.exists() ? st.data() : null;
  if (!set) return null;
  return { month, pm, plan, amends, set };
}

// العدد المطلوب ليوم معين: { موقع: { وظيفة: عدد } }
export function planBySite(base, date) {
  const out = {};
  if (!base) return out;
  const { month, pm, plan, amends, set } = base;
  const day = pm === month ? date : pm + "-31";
  const cmap = new Map();
  plan.rows.forEach(r => { const k = ckey(r.loc, r.pos); const e = cmap.get(k) || { loc: pnorm(r.loc), pos: pnorm(r.pos), value: 0 }; e.value += Number(r.hc) || 0; cmap.set(k, e); });
  cmap.forEach((e, k) => { const hits = amends.filter(a => ckey(a.loc, a.pos) === k && a.effective_date <= day); if (hits.length) e.value = hits[hits.length - 1].to; });
  const add = (site, job, n) => { if (!site) return; (out[site] ??= {})[job] = (out[site][job] || 0) + n; };
  cmap.forEach(e => {
    const job = set.posMap?.[pkey(e.pos)]; if (!job) return;
    const split = (set.splits || []).find(x => ckey(x.loc, x.pos) === ckey(e.loc, e.pos));
    if (split?.parts?.length) {
      const sum = split.parts.reduce((a, p) => a + Number(p.count || 0), 0);
      split.parts.forEach((p, i) => add(pnorm(p.site), job, Number(p.count || 0) + (i === 0 ? e.value - sum : 0)));
      return;
    }
    const ov = (set.overrides || []).find(o => ckey(o.loc, o.pos) === ckey(e.loc, e.pos));
    add(ov ? pnorm(ov.site) : set.locMap?.[pnorm(e.loc)], job, e.value);
  });
  return out;
}
