import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        nav: {
          dashboard: 'Overview',
          groups: 'Groups',
          friends: 'People',
          activity: 'Activity',
          analytics: 'Analytics',
          settings: 'Settings',
        },
        actions: {
          addExpense: 'Add expense',
          settle: 'Settle up',
        },
      },
    },
  },
});

export default i18n;
