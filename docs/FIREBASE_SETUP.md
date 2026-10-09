# Настройка Firebase для NOVA Messenger

Приложение использует Firebase Authentication и Realtime Database. Код приложения уже подключён к проекту `nova-729f3`, но правила базы нужно опубликовать в Firebase Console вручную.

## 1. Включить вход по email

1. Открой Firebase Console и выбери проект `nova-729f3`.
2. Открой **Authentication → Sign-in method**.
3. Включи **Email/Password** и сохрани изменения.

## 2. Опубликовать правила базы

1. Открой **Realtime Database → Rules**.
2. Открой в этом репозитории файл `docs/firebase-database-rules.json`.
3. Скопируй весь JSON из файла в редактор Rules в Firebase Console.
4. Нажми **Publish**.

Не оставляй правила базы в режиме полного публичного чтения и записи. Входящие запросы, список пользователей и сообщения должны проверяться правилами.

## 3. Собрать установщик Windows

Каждый push в ветку `main` запускает GitHub Actions. В репозитории открой **Actions → Build NOVA Messenger → последний запуск**. После успешного запуска скачай артефакт `NOVA-Messenger-Windows`.

## Что уже реализовано в интерфейсе

- регистрация и вход по email/паролю;
- уникальный ник пользователя;
- поиск пользователей по нику;
- заявки в друзья и принятие заявок;
- личные диалоги и сообщения в реальном времени;
- внутренняя валюта NOVA: стартовые 50 монет на аккаунт;
- витрина из семи подарков и отправка подарков в личный чат за монеты;
- редактирование отображаемого имени и описания профиля.

Для работы входа и синхронизации требуется интернет. Это первая рабочая версия, поэтому после тестирования стоит отдельно добавить блокировку пользователей, удаление друзей, статусы прочтения и более строгую проверку данных.

## NOVA 1.1.0 — Premium preview

В интерфейсе добавлена отдельная страница NOVA Premium с бесплатным и планируемым Premium-тарифами. Это только предварительный экран: реальные платежи, подписки, автоматическая выдача Premium-статуса и обработка возвратов ещё не реализованы. Кнопка покупки намеренно отключена, поэтому приложение не принимает оплату и ничего не списывает. Планируемая цена $0.99/месяц не является окончательной.


## NOVA audio calls — WebRTC

Аудиозвонки используют WebRTC и Firebase Realtime Database для сигнализации. Видео не запрашивается. После обновления нужно ещё раз опубликовать правила из `docs/firebase-database-rules.json` в **Realtime Database → Rules**. Без этого новые пути `calls` и `callInbox` будут отклоняться Firebase.

Для первого соединения используются публичные STUN-серверы. Это прототип: некоторые сети/роутеры могут требовать TURN-сервер, поэтому связь между любыми двумя сетями пока не гарантируется. Не передавай никому доступ к Firebase Console и не делай правила базы публичными.


## NOVA Gifts и монеты

Новые аккаунты получают 50 NOVA-монет. При первом входе в старый аккаунт без поля `coins` приложение также добавляет стартовый баланс 50. Внутренняя витрина содержит семь подарков, а отправка уменьшает баланс отправителя и публикует карточку подарка в личном чате. Это клиентский прототип: для публичного запуска валюту и отправку подарков следует перенести на доверенный сервер/Cloud Functions, чтобы исключить подмену баланса модифицированным клиентом.


## NOVA avatars and chat media

The app now supports profile photos (JPG, PNG, WEBP, GIF), looping video avatars (MP4/WebM, maximum 5 seconds), and photo/video attachments in private chats. Current client-side limits: avatar images 8 MB, avatar videos 20 MB, chat images 12 MB, chat videos 50 MB and 60 seconds.

**One-time Firebase setup is required for uploads:**

1. In Firebase Console, open project `nova-729f3` → **Storage** and complete the setup if Storage has not been enabled yet.
2. Open **Storage → Rules**.
3. Copy the full contents of `docs/firebase-storage-rules.txt` from this repository into the Rules editor and click **Publish**.
4. Rebuild the Windows app from GitHub Actions and test uploads while signed in.

These are starter rules, not production security. They allow any signed-in account to read media stored in these paths, because the current client rules do not verify chat membership against Realtime Database. Before inviting public users, move media access to a trusted backend and enforce chat membership there. Firebase Storage may also require a billing plan depending on project configuration.
