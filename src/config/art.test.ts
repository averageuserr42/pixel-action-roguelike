import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ART, ART_FILES, artDivisor, artScale, artSize } from './art';

/**
 * Размер PNG берём из самого файла, а не из таблицы: таблица — это обещание, а
 * файл — факт. Тест читает IHDR (первые 24 байта: 8 подпись, 4 длина, 4 «IHDR»,
 * затем ширина и высота) и не тянет ради этого ни одной зависимости.
 */
function pngSize(file: string): { w: number; h: number } {
  const bytes = readFileSync(`src/assets/${file}`);
  const signature = bytes.subarray(0, 8).toString('latin1');
  assert.equal(signature, '\x89PNG\r\n\x1a\n', `${file} — не PNG`);
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

test('каждый спрайт из таблицы действительно лежит в src/assets', () => {
  for (const spec of ART_FILES) {
    const size = pngSize(spec.file);
    assert.ok(size.w > 0 && size.h > 0, `${spec.file}: пустой PNG`);
  }
});

test('масштаб спрайта — целый делитель исходника', () => {
  for (const spec of ART_FILES) {
    const { h } = pngSize(spec.file);
    const divisor = artDivisor(spec, h);
    assert.equal(Number.isInteger(divisor), true, `${spec.key}: делитель ${divisor}`);
    assert.ok(divisor >= 1, `${spec.key}: делитель меньше единицы`);
    assert.equal(artScale(spec, h), 1 / divisor, `${spec.key}: масштаб не равен 1/делитель`);
    assert.equal(artSize(spec, h), h / divisor, `${spec.key}: размер не совпал с делителем`);
  }
});

test('фактический размер близок к желаемому и спрайт не растягивается', () => {
  for (const spec of ART_FILES) {
    const { h } = pngSize(spec.file);
    const actual = artSize(spec, h);
    assert.ok(actual <= h, `${spec.key}: спрайт увеличивается (${actual} из ${h})`);
    // Округление до целого делителя меняет размер не сильно: иначе желаемые числа
    // в таблице начинают врать, и по ним нельзя раскладывать подписи.
    const error = Math.abs(actual - spec.height) / spec.height;
    assert.ok(error <= 1 / 3, `${spec.key}: обещано ${spec.height}, на экране ${actual}`);
    assert.ok(actual >= 5 && actual <= 26, `${spec.key}: подозрительный размер ${actual}`);
  }
});

test('иерархия силуэтов: виды врагов различимы размером, предметы мельче врагов', () => {
  const h = (name: keyof typeof ART) => {
    const spec = ART[name];
    return artSize(spec, pngSize(spec.file).h);
  };
  // Читаемость без цвета: танк крупнее погонялы, погоняла крупнее делителя.
  assert.ok(h('tank') > h('charger'), 'танк обязан быть крупнее погонялы');
  assert.ok(h('charger') > h('splitter'), 'погоняла крупнее делителя');
  // Предметы — не угроза: батарея и осколок мельче самого мелкого врага, а
  // осколок мельче батареи (его и бросают как искру, а не как запас).
  assert.ok(h('battery') < h('splitter'), 'батарея не должна читаться как враг');
  assert.ok(h('drop') < h('battery'), 'осколок мельче батареи');
});
