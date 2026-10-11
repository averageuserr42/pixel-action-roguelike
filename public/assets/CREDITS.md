# Ассеты: откуда они и на каких условиях

Вся графика в `public/assets` — **CC0 1.0 (общественное достояние)**. Это значит:
использование в любом проекте, включая коммерческий, разрешено, указание автора не
требуется, разрешение спрашивать не нужно. Именно поэтому выбраны эти наборы, а не
красивые CC-BY: у CC0 нет условий, которые можно случайно нарушить.

| Файл | Набор | Источник |
|---|---|---|
| `charger.png`, `tank.png`, `shooter.png`, `splitter.png`, `turret.png`, `drone.png`, `spirit.png`, `mote.png` | Kenney «More Enemies Animations» (CC0) | `moreenemiesanimations/Enemy sprites` |
| `player.png` | Kenney «Topdown Shooter» (CC0) | `topdown-shooter/PNG/Survivor 1/survivor1_stand.png` |
| `battery.png`, `drop.png` | Kenney «Abstract Platformer» (CC0) | `abstract-platformer-370-assets/PNG/Items` |

Файлы скачаны с публичного зеркала наборов Kenney:
`https://github.com/ETdoFresh/kenney.nl` (ветка `master`). Оригиналы — на
`https://kenney.nl/assets`; наборы распространяются под CC0, зеркало лицензию не меняет.

## Как заменять

Имена файлов и их размер в игре живут в одном месте — `src/config/art.ts`. Замена
спрайта: положить новый файл в `public/assets` под тем же именем и, если его пропорции
сильно другие, поправить `height` в `ART`. Ничего больше менять не нужно: масштаб
считается от фактической высоты текстуры.
