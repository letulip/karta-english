import { createApp } from 'vue';
import App from './App.vue';
import { installFlushOnHide } from './lib/api';
import { installConditionsLog } from './lib/conditions';
import './styles/base.css';

// Недописанный ответ дописывается на диск при закрытии вкладки, а уходы со страницы попадают в журнал.
installFlushOnHide();
installConditionsLog();

createApp(App).mount('#app');
