import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import {
  watchedApi,
  SeriesStatsExtended, MovieStatsExtended, WeekEntry, FutureMonthEntry, PastMonthEntry, MarathonEntry, NameCount,
} from '../services/api';
import { TMDB_BASE_URL, TMDB_API_KEY } from '../config/tmdb';

const C = {
  bg:      '#1a1a2e',
  surface: '#16213e',
  card:    '#0f2942',
  primary: '#e94560',
  green:   '#e94560',
  text:    '#ffffff',
  muted:   '#8892a4',
  border:  '#1f4068',
  barGray: '#2a3f5e',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutesToDuration(total: number) {
  const totalHours = Math.floor(total / 60);
  const hours      = totalHours % 24;
  const totalDays  = Math.floor(totalHours / 24);
  const days       = totalDays % 30;
  const months     = Math.floor(totalDays / 30);
  return { months, days, hours };
}

// ─── Bloc carte commun ────────────────────────────────────────────────────────

function StatCard({
  title, children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={card.wrap}>
      <Text style={card.title}>{title}</Text>
      <View style={card.divider} />
      {children}
    </View>
  );
}

const card = StyleSheet.create({
  wrap:    { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 20, gap: 14 },
  title:   { color: C.text, fontSize: 18, fontWeight: '700' },
  divider: { height: 1, backgroundColor: C.border },
});

// ─── Durée TV Time inline ─────────────────────────────────────────────────────

function TVDuration({ totalMinutes }: { totalMinutes: number }) {
  const { months, days, hours } = minutesToDuration(totalMinutes);
  const parts = [
    { value: months, label: ' mois ' },
    { value: days,   label: ' jours ' },
    { value: hours,  label: ' heures' },
  ];
  return (
    <Text style={dur.line} numberOfLines={2}>
      {parts.map(({ value, label }, i) => (
        <React.Fragment key={i}>
          <Text style={dur.num}>{value}</Text>
          <Text style={dur.unit}>{label}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}

const dur = StyleSheet.create({
  line: { flexWrap: 'wrap', lineHeight: 52 },
  num:  { color: C.text, fontSize: 42, fontWeight: '800' },
  unit: { color: C.text, fontSize: 22, fontWeight: '400' },
});

// ─── Grande stat simple ───────────────────────────────────────────────────────

function BigStat({
  value, subtitle, loading,
}: {
  value: string | number;
  subtitle?: string;
  loading: boolean;
}) {
  if (loading) return <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />;
  return (
    <View style={{ gap: 6 }}>
      <Text style={bigSt.value}>
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </Text>
      {subtitle ? <Text style={bigSt.sub}>{subtitle}</Text> : null}
    </View>
  );
}

const bigSt = StyleSheet.create({
  value: { color: C.text, fontSize: 42, fontWeight: '800' },
  sub:   { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
});

// ─── Bloc durée paginé ────────────────────────────────────────────────────────

function DurationCard({
  title, totalMinutes, hoursLast7Days, loading,
}: {
  title: string;
  totalMinutes: number;
  hoursLast7Days: number;
  loading: boolean;
}) {
  const [page, setPage] = useState(0);
  const [blockW, setBlockW] = useState(0);
  const pageW = blockW > 0 ? blockW - 40 : 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageW > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / pageW));
  };

  return (
    <View style={card.wrap} onLayout={e => setBlockW(e.nativeEvent.layout.width)}>
      <Text style={card.title}>{title}</Text>
      <View style={card.divider} />
      {loading ? (
        <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />
      ) : totalMinutes === 0 ? (
        <Text style={empty.text}>Rien pour l'instant.</Text>
      ) : pageW > 0 ? (
        <View style={{ gap: 12 }}>
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            style={{ width: pageW }} onMomentumScrollEnd={onScroll}
          >
            {/* Page 1 : durée décomposée */}
            <View style={{ width: pageW, gap: 8 }}>
              <TVDuration totalMinutes={totalMinutes} />
              <Text style={bigSt.sub}>
                {hoursLast7Days} HEURE{hoursLast7Days !== 1 ? 'S' : ''} AU COURS DES 7 DERNIERS JOURS
              </Text>
            </View>
            {/* Page 2 : total en heures */}
            <View style={{ width: pageW, gap: 8 }}>
              <Text style={bigSt.value}>{Math.floor(totalMinutes / 60).toLocaleString('fr-FR')}</Text>
              <Text style={bigSt.sub}>HEURES AU TOTAL</Text>
            </View>
          </ScrollView>
          <View style={dots.row}>
            <View style={[dots.dot, page === 0 && dots.active]} />
            <View style={[dots.dot, page === 1 && dots.active]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── Graphique en barres hebdomadaire ─────────────────────────────────────────

const BAR_MAX_H = 96;
const BAR_W     = 26;

function WeeklyBarChart({
  entries, valueKey, axisLabel,
}: {
  entries: WeekEntry[];
  valueKey: 'hours' | 'count';
  axisLabel: string;
}) {
  const values = entries.map(e => valueKey === 'hours' ? e.hours : e.count);
  const maxVal = Math.max(...values, 1);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Y-axis label */}
        <View style={wbc.yLabelWrap}>
          <Text style={wbc.yLabel}>{axisLabel}</Text>
        </View>
        {/* Bars */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={wbc.row}>
          {entries.map((entry, i) => {
            const val = valueKey === 'hours' ? entry.hours : entry.count;
            const barH = Math.max(4, Math.round((val / maxVal) * BAR_MAX_H));
            const color = entry.is_current ? C.green : C.barGray;
            const label = valueKey === 'hours'
              ? (val > 0 ? (Number.isInteger(val) ? String(val) : val.toFixed(1)) : '0')
              : String(val);
            return (
              <View key={i} style={wbc.col}>
                <Text style={wbc.countLabel}>{label}</Text>
                <View style={[wbc.bar, { height: barH, backgroundColor: color }]} />
                <Text style={wbc.weekLabel}>{entry.week}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
      <Text style={wbc.footer}>PAR SEMAINE</Text>
    </View>
  );
}

const wbc = StyleSheet.create({
  yLabelWrap:  { width: 18, height: BAR_MAX_H + 30, justifyContent: 'center', alignItems: 'center' },
  yLabel: {
    color: C.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5,
    transform: [{ rotate: '-90deg' }], width: 70, textAlign: 'center',
  },
  row:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingBottom: 4 },
  col:        { alignItems: 'center', gap: 4, width: BAR_W + 6 },
  bar:        { width: BAR_W, borderRadius: 4 },
  countLabel: { color: C.muted, fontSize: 10, fontWeight: '700' },
  weekLabel:  { color: C.muted, fontSize: 10, fontWeight: '600' },
  footer:     { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
});

// ─── Graphique en barres mensuel ──────────────────────────────────────────────

function MonthlyBarChart({
  entries, valueKey, axisLabel,
}: {
  entries: FutureMonthEntry[];
  valueKey: 'count' | 'hours';
  axisLabel: string;
}) {
  const values = entries.map(e => valueKey === 'count' ? e.count : e.hours);
  const maxVal = Math.max(...values, 1);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={wbc.yLabelWrap}>
          <Text style={wbc.yLabel}>{axisLabel}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={wbc.row}>
          {entries.map((entry, i) => {
            const val = valueKey === 'count' ? entry.count : entry.hours;
            const barH = Math.max(4, Math.round((val / maxVal) * BAR_MAX_H));
            const color = i === 0 ? C.green : C.barGray;
            const label = valueKey === 'hours'
              ? (val > 0 ? (Number.isInteger(val) ? String(val) : val.toFixed(1)) : '0')
              : String(val);
            return (
              <View key={i} style={wbc.col}>
                <Text style={wbc.countLabel}>{label}</Text>
                <View style={[wbc.bar, { height: barH, backgroundColor: color }]} />
                <Text style={wbc.weekLabel}>{entry.label}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Graphique barres mensuel historique ──────────────────────────────────────

function PastMonthlyBarChart({
  entries, valueKey, axisLabel,
}: {
  entries: PastMonthEntry[];
  valueKey: 'hours' | 'count';
  axisLabel: string;
}) {
  const values = entries.map(e => valueKey === 'hours' ? e.hours : e.count);
  const maxVal = Math.max(...values, 1);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={wbc.yLabelWrap}>
          <Text style={wbc.yLabel}>{axisLabel}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={wbc.row}>
          {entries.map((entry, i) => {
            const val = valueKey === 'hours' ? entry.hours : entry.count;
            const barH = Math.max(4, Math.round((val / maxVal) * BAR_MAX_H));
            const color = entry.is_current ? C.green : C.barGray;
            const label = valueKey === 'hours'
              ? (val > 0 ? (Number.isInteger(val) ? String(val) : val.toFixed(1)) : '0')
              : String(val);
            return (
              <View key={i} style={wbc.col}>
                <Text style={wbc.countLabel}>{label}</Text>
                <View style={[wbc.bar, { height: barH, backgroundColor: color }]} />
                <Text style={wbc.weekLabel}>{entry.label}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
      <Text style={wbc.footer}>PAR MOIS</Text>
    </View>
  );
}

// ─── Chart paginé semaine / mois (dots tapables) ──────────────────────────────

function ChartWithPager({
  weekEntries, pastMonths, valueKey, axisLabel, loading,
}: {
  weekEntries: WeekEntry[];
  pastMonths: PastMonthEntry[];
  valueKey: 'hours' | 'count';
  axisLabel: string;
  loading: boolean;
}) {
  const [page, setPage] = useState(0);

  if (loading) {
    return <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />;
  }

  return (
    <View style={{ gap: 12 }}>
      {page === 0
        ? <WeeklyBarChart entries={weekEntries} valueKey={valueKey} axisLabel={axisLabel} />
        : <PastMonthlyBarChart entries={pastMonths} valueKey={valueKey} axisLabel={axisLabel} />
      }
      <View style={dots.row}>
        <TouchableOpacity onPress={() => setPage(0)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <View style={[dots.dot, page === 0 && dots.active]} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setPage(1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <View style={[dots.dot, page === 1 && dots.active]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Tableau classement ───────────────────────────────────────────────────────

function RankTable({
  col1Label, col2Label, rows, loading,
}: {
  col1Label: string;
  col2Label: string;
  rows: NameCount[];
  loading: boolean;
}) {
  if (loading) return <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />;
  if (rows.length === 0) return <Text style={empty.text}>Aucune donnée.</Text>;
  return (
    <View style={{ gap: 0 }}>
      {/* En-tête */}
      <View style={tbl.header}>
        <Text style={tbl.hCell}>{col1Label}</Text>
        <Text style={[tbl.hCell, tbl.right]}>{col2Label}</Text>
      </View>
      {rows.map((row, i) => (
        <View key={i} style={tbl.row}>
          <Text style={tbl.cell} numberOfLines={1}>{row.name}</Text>
          <Text style={[tbl.cell, tbl.right]}>{row.count}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Tableau marathons ────────────────────────────────────────────────────────

function MarathonTable({
  rows, loading,
}: {
  rows: MarathonEntry[];
  loading: boolean;
}) {
  if (loading) return <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />;
  if (rows.length === 0) return <Text style={empty.text}>Aucune donnée.</Text>;
  return (
    <View style={{ gap: 0 }}>
      <View style={tbl.header}>
        <Text style={[tbl.hCell, { flex: 1 }]}>SÉRIE</Text>
        <Text style={[tbl.hCell, tbl.right, { width: 70 }]}>ÉPISODES</Text>
        <Text style={[tbl.hCell, tbl.right, { width: 56 }]}>HEURES</Text>
      </View>
      {rows.map((row, i) => (
        <View key={i} style={tbl.row}>
          <Text style={[tbl.cell, { flex: 1 }]} numberOfLines={1}>{row.title}</Text>
          <Text style={[tbl.cell, tbl.right, { width: 70 }]}>{row.episode_count}</Text>
          <Text style={[tbl.cell, tbl.right, { width: 56 }]}>{row.hours}</Text>
        </View>
      ))}
    </View>
  );
}

const tbl = StyleSheet.create({
  header: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderColor: C.border },
  row:    { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  hCell:  { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', flex: 1 },
  cell:   { color: C.text, fontSize: 15, fontWeight: '400' },
  right:  { textAlign: 'right', flex: 0 },
});

const empty = StyleSheet.create({
  text: { color: C.muted, fontSize: 13 },
});

const dots = StyleSheet.create({
  row:    { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  active: { backgroundColor: C.primary },
});

// ─── Onglet Séries ────────────────────────────────────────────────────────────

function SeriesStatsTab() {
  const [loading,       setLoading]       = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [data,          setData]          = useState<SeriesStatsExtended | null>(null);
  const [error,         setError]         = useState(false);

  const loadStats = () => {
    setLoading(true);
    setError(false);
    watchedApi.seriesStatsExtended()
      .then(res => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useFocusEffect(React.useCallback(() => { loadStats(); }, []));

  const handleRecalculate = () => {
    Alert.alert(
      'Recalculer les statistiques',
      'Le temps de visionnage sera recalculé en interrogeant TMDB pour chaque série. Cela peut prendre une à deux minutes selon la taille de ta bibliothèque.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Recalculer',
          onPress: async () => {
            setRecalculating(true);
            try {
              const summaryRes = await watchedApi.seriesSummary();
              const watched = summaryRes.data.filter(s => s.watched_count > 0);
              let total = 0;
              for (const summary of watched) {
                try {
                  const { data: tv } = await axios.get(`${TMDB_BASE_URL}/tv/${summary.series_tmdb_id}`, {
                    params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
                  });
                  let runtime: number = (tv.episode_run_time as number[] | undefined)?.[0] ?? 0;
                  if (runtime === 0) {
                    try {
                      const { data: s1 } = await axios.get(
                        `${TMDB_BASE_URL}/tv/${summary.series_tmdb_id}/season/1`,
                        { params: { api_key: TMDB_API_KEY } },
                      );
                      const ep = (s1.episodes as any[] | undefined)?.find((e: any) => e.runtime > 0);
                      runtime = ep?.runtime ?? 0;
                    } catch {}
                  }
                  if (runtime > 0) {
                    total += summary.watched_count * runtime;
                    // Met à jour les runtime_minutes par épisode pour que les charts soient exacts
                    try { await watchedApi.updateEpisodeRuntimes(summary.series_tmdb_id, runtime); } catch {}
                  }
                } catch {}
                await new Promise(r => setTimeout(r, 300));
              }
              await watchedApi.setSeriesStats(total);
              loadStats();
            } catch {
              Alert.alert('Erreur', 'Impossible de recalculer les statistiques.');
            } finally {
              setRecalculating(false);
            }
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <View style={ss.centered}>
        <Ionicons name="alert-circle-outline" size={36} color={C.primary} />
        <Text style={ss.errorText}>Impossible de charger les statistiques.</Text>
      </View>
    );
  }

  const hoursLast7 = data ? Math.floor(data.minutes_last_7_days / 60) : 0;
  const remainingHours = data ? Math.floor(data.remaining_minutes / 60) : 0;

  return (
    <ScrollView contentContainerStyle={ss.scroll}>

      {/* 1 ── Temps passé devant des épisodes */}
      <DurationCard
        title="Temps passé devant des épisodes"
        totalMinutes={data?.total_minutes ?? 0}
        hoursLast7Days={hoursLast7}
        loading={loading}
      />

      {/* 2 ── Heures par semaine / par mois */}
      <StatCard title="Temps passé devant des épisodes">
        <ChartWithPager
          weekEntries={data?.week_data ?? []}
          pastMonths={data?.past_months ?? []}
          valueKey="hours"
          axisLabel="HEURES"
          loading={loading}
        />
      </StatCard>

      {/* 4 ── Nombre total d'épisodes vus */}
      <StatCard title="Nombre total d'épisodes vus">
        <BigStat
          value={data?.episode_count ?? 0}
          subtitle={`${data?.episodes_last_7_days ?? 0} LORS DES 7 DERNIERS JOURS`}
          loading={loading}
        />
      </StatCard>

      {/* 5 ── Épisodes vus par semaine / par mois */}
      <StatCard title="Épisodes vus">
        <ChartWithPager
          weekEntries={data?.week_data ?? []}
          pastMonths={data?.past_months ?? []}
          valueKey="count"
          axisLabel="ÉPISODES"
          loading={loading}
        />
      </StatCard>

      {/* 6 ── Séries ajoutées */}
      <StatCard title="Séries ajoutées">
        <BigStat
          value={data?.series_count ?? 0}
          subtitle={`${data?.series_in_production ?? 0} TOUJOURS EN PRODUCTION`}
          loading={loading}
        />
      </StatCard>

      {/* 4 ── Épisodes restants */}
      <StatCard title="Épisodes restants">
        <BigStat
          value={data?.remaining_episodes ?? 0}
          subtitle={`POUR ${data?.started_series_count ?? 0} SÉRIES COMMENCÉES`}
          loading={loading}
        />
      </StatCard>

      {/* 7 ── Épisodes à venir (estimés) */}
      <StatCard title="Épisodes à venir">
        {loading ? (
          <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <MonthlyBarChart entries={data?.future_months ?? []} valueKey="count" axisLabel="ÉPISODES" />
        )}
      </StatCard>

      {/* 8 ── Cadence */}
      <StatCard title="À quelle vitesse avancez-vous dans vos séries">
        <BigStat
          value={data ? `${data.pace_per_week.toLocaleString('fr-FR')} épisodes/semaine` : '—'}
          subtitle="D'APRÈS LES ÉPISODES QUE VOUS AVEZ VUS CES DEUX DERNIERS MOIS"
          loading={loading}
        />
      </StatCard>

      {/* 9 ── Temps de visionnement restant */}
      <StatCard title="Temps de visionnement restant">
        <BigStat
          value={remainingHours.toLocaleString('fr-FR')}
          subtitle="HEURES"
          loading={loading}
        />
      </StatCard>

      {/* 10 ── Temps de visionnage futur */}
      <StatCard title="Temps de visionnage futur">
        {loading ? (
          <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <MonthlyBarChart entries={data?.future_months ?? []} valueKey="hours" axisLabel="HEURES" />
        )}
      </StatCard>

      {/* 11 ── Quand rattraper */}
      <StatCard title="Quand allez-vous rattraper vos épisodes">
        <BigStat
          value={data?.catch_up_date || '—'}
          subtitle="D'APRÈS LES ÉPISODES QUE VOUS AVEZ VUS CES DEUX DERNIERS MOIS"
          loading={loading}
        />
      </StatCard>

      {/* Bouton recalcul */}
      <TouchableOpacity
        style={ss.recalcBtn}
        onPress={handleRecalculate}
        activeOpacity={0.7}
        disabled={recalculating || loading}
      >
        {recalculating ? (
          <ActivityIndicator size="small" color={C.muted} />
        ) : (
          <Ionicons name="refresh-outline" size={15} color={C.muted} />
        )}
        <Text style={ss.recalcText}>
          {recalculating ? 'Recalcul en cours…' : 'Recalculer mes stats'}
        </Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const ss = StyleSheet.create({
  scroll:    { padding: 16, gap: 16, paddingBottom: 80 },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  errorText: { color: C.primary, fontSize: 14, textAlign: 'center' },
  recalcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: 4,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  recalcText: { color: C.muted, fontSize: 13 },
});

// ─── Onglet Films ─────────────────────────────────────────────────────────────

function FilmsStatsTab() {
  const [loading,       setLoading]       = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [data,          setData]          = useState<MovieStatsExtended | null>(null);
  const [error,         setError]         = useState(false);

  const loadStats = () => {
    setLoading(true);
    setError(false);
    watchedApi.movieStatsExtended()
      .then(res => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useFocusEffect(React.useCallback(() => { loadStats(); }, []));

  const handleRecalculate = () => {
    Alert.alert(
      'Recalculer les statistiques',
      'Le temps de visionnage sera recalculé en interrogeant TMDB pour chaque film. Cela peut prendre quelques instants.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Recalculer',
          onPress: async () => {
            setRecalculating(true);
            try {
              const summaryRes = await watchedApi.moviesSummary();
              const movies = summaryRes.data;
              let total = 0;
              for (const movie of movies) {
                try {
                  const { data: tmdb } = await axios.get(`${TMDB_BASE_URL}/movie/${movie.tmdb_id}`, {
                    params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
                  });
                  const runtime: number = (tmdb.runtime as number | undefined) ?? 0;
                  const releaseYear = parseInt((tmdb.release_date as string | undefined)?.slice(0, 4) ?? '0', 10) || 0;
                  if (runtime > 0) total += runtime * (1 + movie.rewatch_count);
                  try { await watchedApi.updateMovieRuntime(movie.tmdb_id, runtime, releaseYear); } catch {}
                } catch {}
                await new Promise(r => setTimeout(r, 300));
              }
              await watchedApi.setMovieStats(total);
              loadStats();
            } catch {
              Alert.alert('Erreur', 'Impossible de recalculer les statistiques.');
            } finally {
              setRecalculating(false);
            }
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <View style={ss.centered}>
        <Ionicons name="alert-circle-outline" size={36} color={C.primary} />
        <Text style={ss.errorText}>Impossible de charger les statistiques.</Text>
      </View>
    );
  }

  const hoursLast7 = data ? Math.floor(data.minutes_last_7_days / 60) : 0;
  const remainingHours = data ? Math.floor(data.remaining_minutes / 60) : 0;
  const decades = data?.decades ?? [];
  const maxDecade = decades.length > 0 ? Math.max(...decades.map(d => d.count)) : 1;

  return (
    <ScrollView contentContainerStyle={ss.scroll}>

      {/* 1 ── Temps passé devant des films (paginé) */}
      <DurationCard
        title="Temps passé à regarder des films"
        totalMinutes={data?.total_minutes ?? 0}
        hoursLast7Days={hoursLast7}
        loading={loading}
      />

      {/* 2 ── Heures par semaine / par mois */}
      <StatCard title="Temps passé à regarder des films">
        <ChartWithPager
          weekEntries={data?.week_data ?? []}
          pastMonths={data?.past_months ?? []}
          valueKey="hours"
          axisLabel="HEURES"
          loading={loading}
        />
      </StatCard>

      {/* 3 ── Nombre total de films vus */}
      <StatCard title="Nombre total de films vus">
        <BigStat
          value={data?.movie_count ?? 0}
          subtitle={`${data?.movies_last_7_days ?? 0} LORS DES 7 DERNIERS JOURS`}
          loading={loading}
        />
      </StatCard>

      {/* 4 ── Films regardés par semaine / par mois */}
      <StatCard title="Films regardés">
        <ChartWithPager
          weekEntries={data?.week_data ?? []}
          pastMonths={data?.past_months ?? []}
          valueKey="count"
          axisLabel="FILMS"
          loading={loading}
        />
      </StatCard>

      {/* 5 ── Films ajoutés */}
      <StatCard title="Films ajoutés">
        <BigStat
          value={data?.movies_added ?? 0}
          loading={loading}
        />
      </StatCard>

      {/* 6 ── Films restants */}
      <StatCard title="Films restants">
        <BigStat
          value={data?.movies_remaining ?? 0}
          loading={loading}
        />
      </StatCard>

      {/* 7 ── Films à venir (estimés) */}
      <StatCard title="Films à venir">
        {loading ? (
          <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <MonthlyBarChart entries={data?.future_months ?? []} valueKey="count" axisLabel="FILMS" />
        )}
      </StatCard>

      {/* 8 ── Cadence */}
      <StatCard title="À quelle vitesse avancez-vous dans le visionnage">
        <BigStat
          value={data ? `${data.pace_per_week.toLocaleString('fr-FR')} films/semaine` : '—'}
          subtitle="D'APRÈS LES FILMS QUE VOUS AVEZ VUS CES DEUX DERNIERS MOIS"
          loading={loading}
        />
      </StatCard>

      {/* 9 ── Temps de visionnement restant */}
      <StatCard title="Temps de visionnement restant">
        <BigStat
          value={remainingHours.toLocaleString('fr-FR')}
          subtitle="HEURES"
          loading={loading}
        />
      </StatCard>

      {/* 10 ── Temps de visionnage futur */}
      <StatCard title="Temps de visionnage futur">
        {loading ? (
          <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <MonthlyBarChart entries={data?.future_months ?? []} valueKey="hours" axisLabel="HEURES" />
        )}
      </StatCard>

      {/* 11 ── Quand rattraper */}
      <StatCard title="Quand allez-vous rattraper vos films ?">
        <BigStat
          value={data?.catch_up_date || '—'}
          subtitle="D'APRÈS LES FILMS QUE VOUS AVEZ VUS CES DEUX DERNIERS MOIS"
          loading={loading}
        />
      </StatCard>

      {/* 12 ── Films vus par décennie */}
      <StatCard title="Films vus par décennie">
        {loading ? (
          <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start' }} />
        ) : decades.length === 0 ? (
          <Text style={empty.text}>Aucune donnée pour l'instant.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={wbc.row}>
            {decades.map(({ decade, count }) => {
              const barH = Math.max(4, Math.round((count / maxDecade) * BAR_MAX_H));
              return (
                <View key={decade} style={wbc.col}>
                  <Text style={wbc.countLabel}>{count}</Text>
                  <View style={[wbc.bar, { height: barH, backgroundColor: C.primary }]} />
                  <Text style={wbc.weekLabel}>{decade}s</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </StatCard>

      {/* Bouton recalcul */}
      <TouchableOpacity
        style={ss.recalcBtn}
        onPress={handleRecalculate}
        activeOpacity={0.7}
        disabled={recalculating || loading}
      >
        {recalculating ? (
          <ActivityIndicator size="small" color={C.muted} />
        ) : (
          <Ionicons name="refresh-outline" size={15} color={C.muted} />
        )}
        <Text style={ss.recalcText}>
          {recalculating ? 'Recalcul en cours…' : 'Recalculer mes stats'}
        </Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

type Tab = 'series' | 'films';

export default function StatisticsScreen() {
  const navigation = useNavigation();
  const [tab, setTab] = useState<Tab>('series');

  return (
    <SafeAreaView style={root.safeArea} edges={['top']}>
      {/* Header */}
      <View style={root.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={root.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={root.headerTitle}>Statistiques</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Onglets */}
      <View style={root.tabs}>
        {(['series', 'films'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[root.tab, tab === t && root.tabActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[root.tabText, tab === t && root.tabTextActive]}>
              {t === 'series' ? 'SÉRIES' : 'FILMS'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Contenu */}
      {tab === 'series' ? <SeriesStatsTab /> : <FilmsStatsTab />}
    </SafeAreaView>
  );
}

const root = StyleSheet.create({
  safeArea:      { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
  },
  backBtn:       { width: 40, alignItems: 'center' },
  headerTitle:   { color: C.text, fontSize: 17, fontWeight: '700' },
  tabs: {
    flexDirection: 'row', backgroundColor: C.surface,
    marginHorizontal: 12, marginBottom: 8,
    borderRadius: 10, padding: 4,
    borderWidth: 1, borderColor: C.border,
  },
  tab:           { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 7 },
  tabActive:     { backgroundColor: C.primary },
  tabText:       { color: C.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  tabTextActive: { color: C.text },
});
