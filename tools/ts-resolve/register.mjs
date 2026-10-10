import { register } from 'node:module';

// Регистрация хука — отдельным файлом, потому что `--import` загружает модуль,
// а хуки обязаны быть зарегистрированы через module.register().
register('./hooks.mjs', import.meta.url);
