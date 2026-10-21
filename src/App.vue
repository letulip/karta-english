<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { PARTS } from './content/parts';
import { goHome, loadSession, state } from './lib/session';
import BiographyPart from './components/BiographyPart.vue';
import EfsetPart from './components/EfsetPart.vue';
import GrammarPart from './components/GrammarPart.vue';
import HomeView from './components/HomeView.vue';
import SaveIndicator from './components/SaveIndicator.vue';
import SelfAssessmentPart from './components/SelfAssessmentPart.vue';
import SpeakingPart from './components/SpeakingPart.vue';
import WritingPart from './components/WritingPart.vue';

const current = computed(() => PARTS.find((p) => p.id === state.view));

onMounted(loadSession);
</script>

<template>
  <header class="topbar">
    <div class="topbar-inner">
      <template v-if="current">
        <button class="btn ghost small" type="button" :disabled="state.lockNav" @click="goHome">← Все части</button>
        <span class="muted">Часть {{ current.n }} · {{ current.title }}</span>
      </template>
      <strong v-else>Карта английского</strong>
      <SaveIndicator />
    </div>
  </header>

  <main class="page stack">
    <p v-if="state.loading" class="muted">Загружаю…</p>
    <div v-else-if="state.error" class="card danger">{{ state.error }}</div>
    <HomeView v-else-if="state.view === 'home'" />
    <BiographyPart v-else-if="state.view === 'biography'" />
    <SelfAssessmentPart v-else-if="state.view === 'self'" />
    <EfsetPart v-else-if="state.view === 'efset'" />
    <GrammarPart v-else-if="state.view === 'grammar'" />
    <WritingPart v-else-if="state.view === 'writing'" />
    <SpeakingPart v-else-if="state.view === 'speaking'" />
  </main>
</template>
