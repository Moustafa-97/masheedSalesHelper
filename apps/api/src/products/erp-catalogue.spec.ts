import { groupErpRows, parseLoad, shortName } from './erp-catalogue.js';
import { Unit } from './product.entities.js';

describe('shortName', () => {
  it.each([
    ['Hadeed (Sabic)', 'Hadeed (Sabic), Steel Rebar, Grade 60, D:12mm, L:12 M', 'Rebar G60 · 12mm · 12m'],
    ['Hadeed (Sabic)', 'Sabic, Steel Rebar, Grade 60, D:8mm, L:12 M', 'Rebar G60 · 8mm · 12m'],
    ['Itfaq', 'Itfaq, Steel Rebar, Grade 60, D:12mm , L:12 M', 'Rebar G60 · 12mm · 12m'],
    ['Hadeed (Sabic)', 'Hadeed (Sabic), Steel Rebar, Grade 40, D:08mm, L:06 M', 'Rebar G40 · 8mm · 6m'],
    ['Rajhi Steel', 'Rajhi, Steel Eboxy , Grade 60, D: 10mm , L : 12 M', 'Epoxy Rebar G60 · 10mm · 12m'],
    ['Rajhi Steel', 'Rajhi, Steel Reinforcing Mesh, Grade 60, D:6mm, Grid:20*20,', 'Mesh G60 · 6mm · 20×20'],
    ['Rajhi Steel', 'Galvanized Iron Wire 6 kg - 18 Guage', 'Galvanized Iron Wire 6 kg - 18 Gauge'],
    ['Abo Alreesh', 'Abo Alreesh, Cement Block, Hollow 3 Cells (40*20*20)', 'Block Hollow 3 Cells (40*20*20)'],
    ['Al Saif Al Zahaby', 'Al Saif Al Zahaby , Cement Block, Hollow  6 Cells(40*20*20)', 'Block Hollow 6 Cells (40*20*20)'],
    ['DC', 'DC Block, Cement Block, Hurdy (40*20*20)', 'Block Hurdy (40*20*20)'],
    ['Almomiz', 'Almomiz, Cement Block, Solid Block (40*20*20)', 'Solid Block (40*20*20)'],
    ['Almomiz', 'Almomiz, Cement Block, Pipe Block (20*20*20)', 'Pipe Block (20*20*20)'],
    ['Cement Al Safwa’s', 'Alsafwa Cement - SRC', 'SRC'],
    ['City Cement', 'City Cement - Finishing cement', 'Finishing Cement'],
    ['Umm AlQura', 'Umm Al Qura Cement- OPC', 'OPC'],
    ['Northern Cement', 'Northern Cement-White Cement CEM 1', 'White Cement CEM 1'],
    ['Jazeera Paints', 'Jazeerapaints , TILEX , Highly Adhesive Tile Glue 20Kg', 'TILEX , Highly Adhesive Tile Glue 20Kg'],
    ['Sika®', 'Sika, Ceram® - 202 Gray, 20 KG/Bag', 'Ceram® - 202 Gray, 20 KG/Bag'],
    ['Sika®', 'Sikadur®-507, 1 KG', 'Sikadur®-507, 1 KG'],
    ['Supra', 'Al khalig Gypsum - Supra Platre De Paris White Gypsum Powder', 'Al khalig Gypsum - Supra Platre De Paris White Gypsum Powder'],
    ['Generic', 'Aggregates, Midum Size', 'Aggregates, Medium Size'],
    ['Bimad', 'BIMAD- China Film Face Plywood (4*8 - 16MM)', 'China Film Face Plywood (4*8 - 16MM)'],
  ])('%s: %s', (brand, name, expected) => {
    expect(shortName(brand, name)).toBe(expected);
  });
});

describe('parseLoad', () => {
  it.each([
    ['Ton', Unit.TON, null],
    ['580 Bags', Unit.BAG, 580],
    ['600 Pallet', Unit.BAG, 600],
    ['1000 Piece', Unit.PIECE, 1000],
    ['Pcs', Unit.PIECE, null],
    ['Trailer 18', Unit.TRAILER, 18],
    ['gal', Unit.GALLON, null],
  ])('%s', (label, unit, loadQty) => {
    expect(parseLoad(label)).toEqual({ unit, loadQty });
  });
});

describe('groupErpRows', () => {
  it('merges regions, loads and colours of the same item', () => {
    const base = { category: 'Grey Cement', brand: 'City Cement', name: 'City Cement - OPC', color: '' };
    const items = groupErpRows([
      { ...base, zone: 'Riyadh', unit: '580 Bags' },
      { ...base, zone: 'Riyadh', unit: '600 Pallet' },
      { ...base, zone: 'Riyadh', unit: '580 Bags' },
      { ...base, zone: 'Qassim', unit: 'Bags', color: 'Grey' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ shortName: 'OPC', unit: Unit.BAG, colors: ['Grey'] });
    expect(items[0].zones).toEqual([
      { zone: 'Riyadh', label: '580 Bags', loadQty: 580 },
      { zone: 'Riyadh', label: '600 Pallet', loadQty: 600 },
      { zone: 'Qassim', label: 'Bags', loadQty: null },
    ]);
  });
});
