"""
Migración de las planillas de Cambios Dorados a CSV listos para cargar en la base.
Se puede correr las veces que haga falta: siempre genera los mismos archivos desde cero.

Uso:  python3 migrar.py <carpeta_salida>
Lee:  Ventas (Compilado, Facturacion_Log), Remitos (Venta_General, Venta_Detalle,
      Productos, Import Tienda Nube, Cierre_Logs), Egresos (Egresos, Egresos_Telegram,
      EGRESOS CHO EXTRA), Tablero (AJUSTES).
"""
import csv, os, re, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from leer import sheets

OUT = sys.argv[1] if len(sys.argv) > 1 else 'salida'
os.makedirs(OUT, exist_ok=True)
reporte = collections.OrderedDict()
montos_raros = collections.Counter()
fechas_sin_anio = collections.Counter()

# ---------------------------------------------------------------- helpers
def g(r, i):
    return r[i].strip() if len(r) > i and r[i] is not None else ''

def monto(s):
    try:
        return _monto(s)
    except ValueError:
        t = (s or '').replace('$', '').replace(' ', '')
        m = re.fullmatch(r'([\d.,]+)[.,](\d{2})', t)       # 18.216.90 o 18,216,90 -> 18216.90
        if m:
            montos_raros['corregido: ' + t] += 1
            return round(float(re.sub(r'[.,]', '', m.group(1)) + '.' + m.group(2)), 2)
        montos_raros[t] += 1
        return None

def _monto(s):
    """'8.000' -> 8000 · '1000000,35' -> 1000000.35 · '190650.02' -> 190650.02 · '17,900.00' -> 17900"""
    s = (s or '').replace('$', '').replace(' ', '').strip()
    if not s or s in '-–':
        return None
    if not re.fullmatch(r'-?[\d.,]+', s):
        montos_raros[s] += 1
        return None
    if re.fullmatch(r'-?\d{1,3}(,\d{3})+\.\d{2}', s):          # 17,900.00 (export Tiendanube)
        return round(float(s.replace(',', '')), 2)
    if ',' in s:                                                # 1.000.000,35
        return round(float(s.replace('.', '').replace(',', '.')), 2)
    if re.fullmatch(r'-?\d+\.\d{1,2}', s):                      # 190650.02
        return round(float(s), 2)
    return round(float(s.replace('.', '')), 2)                  # 8.000 / 220600

def fecha(s, anio=None):
    s = (s or '').strip().split(' ')[0]
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})', s)               # '27/10' sin año: usa la columna AÑO
    if m and anio and re.fullmatch(r'\d{4}', str(anio).strip()):
        fechas_sin_anio[s] += 1
        s = f'{s}/{str(anio).strip()}'
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m:
        d, mo, y = map(int, m.groups())
        return f'{y:04d}-{mo:02d}-{d:02d}'
    m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', s)
    return s if m else None

def escribir(nombre, campos, filas):
    with open(os.path.join(OUT, nombre + '.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction='ignore')
        w.writeheader()
        for fila in filas:
            w.writerow({k: ('' if fila.get(k) is None else fila.get(k)) for k in campos})
    reporte[nombre] = len(filas)

# ------------------------------------------------------------ catálogos
MEDIOS = {  # nombre en planilla (minúsculas) -> nombre unificado
    'transferencia santander': 'Transferencia Santander', 'transferencia galicia': 'Transferencia Galicia',
    'efectivo': 'Efectivo', 'mercado pago': 'Mercado Pago',
    'santander (getnet)': 'Getnet (Santander)', 'getnet (santander)': 'Getnet (Santander)',
    'nave (galicia)': 'Nave (Galicia)', 'pago nube': 'Pago Nube', 'cambio mercaderia': 'Cambio de mercadería',
}
DESCUENTO = {'Efectivo': 15, 'Transferencia Santander': 15, 'Transferencia Galicia': 15}  # a confirmar
CON_COMISION = {'Getnet (Santander)', 'Mercado Pago', 'Nave (Galicia)', 'Pago Nube'}
COMISION = {'Getnet (Santander)': 15, 'Mercado Pago': 15, 'Nave (Galicia)': 15}  # aprox., a ajustar
CANALES = {
    'venta showroom': 'Showroom', 'venta whatsapp': 'WhatsApp', 'venta web': 'Web',
    'venta instagram': 'Instagram', 'venta arquis': 'Arquitectos', 'venta estilismo': 'Estilismo',
    'asesoría': 'Asesoría', 'asesoria': 'Asesoría', 'producto a medida': 'Producto a medida',
}
VENDEDOR_ALIAS = {'cho': 'Joan', 'sele': 'Sele', 'mica': 'Mica', 'mali': 'Mali', 'joan': 'Joan'}

medios_vistos, canales_vistos, vendedores_vistos = collections.Counter(), collections.Counter(), collections.Counter()
sin_mapear = collections.defaultdict(collections.Counter)

def medio(s):
    m = MEDIOS.get(s.strip().lower())
    if not m:
        sin_mapear['medio_pago'][s] += 1
        m = 'Sin dato' if not s.strip() else s.strip()
    medios_vistos[m] += 1
    return m

def canal(obs):
    o = obs.strip().lower()
    c = CANALES.get(o)
    if not c:
        if o:
            sin_mapear['canal'][obs] += 1
        c = 'Showroom' if 'showroom' in o else 'Sin dato'
    canales_vistos[c] += 1
    return c

def vendedores(s):
    nombres = []
    for p in re.split(r'\s*(?:/|\||\by\b)\s*', s.strip()):
        if not p:
            continue
        n = VENDEDOR_ALIAS.get(p.strip().lower())
        if not n:
            sin_mapear['vendedor'][p] += 1
            continue
        if n not in nombres:
            nombres.append(n)
    for n in nombres:
        vendedores_vistos[n] += 1
    return nombres

# ------------------------------------------------------------ lectura
V = sheets('ventas'); R = sheets('remitos'); E = sheets('egresos'); T = sheets('tablero')

# ============================================================ PRODUCTOS
tn_por_nombre = {}
for r in R['Import Tienda Nube'][1:]:
    if g(r, 1):
        tn_por_nombre.setdefault(g(r, 1).lower(), r)

categorias = collections.OrderedDict()   # ruta "Padre > Hijo" -> (nombre, padre)
productos, variantes_ = [], []
for r in R['Productos'][1:]:
    cod, nom = g(r, 0), g(r, 1)
    if not cod or not nom:
        continue
    tn = tn_por_nombre.get(nom.lower())
    cat = ''
    if tn and g(tn, 3):
        cat = g(tn, 3).split(',')[0].strip()           # primera categoría
        partes = [p.strip() for p in cat.split('>')]
        for i in range(len(partes)):
            ruta = ' > '.join(partes[:i + 1])
            categorias.setdefault(ruta, (partes[i], ' > '.join(partes[:i]) or None))
    productos.append({'codigo': cod, 'nombre': nom, 'categoria': cat,
                      'tiendanube_handle': g(tn, 0) if tn else '', 'en_web': bool(tn)})
    variantes_.append({'producto_codigo': cod, 'codigo': cod + '-01', 'atributos': '{}',
                       'precio': monto(g(tn, 10)) if tn else monto(g(r, 3)),
                       'costo': '', 'stock_minimo': 0})
escribir('categorias', ['ruta', 'nombre', 'padre_ruta'],
         [{'ruta': k, 'nombre': v[0], 'padre_ruta': v[1]} for k, v in categorias.items()])
escribir('productos', ['codigo', 'nombre', 'categoria', 'tiendanube_handle', 'en_web'], productos)
escribir('variantes', ['producto_codigo', 'codigo', 'atributos', 'precio', 'costo', 'stock_minimo'], variantes_)
reporte['productos_con_tiendanube'] = sum(1 for p in productos if p['en_web'])

# ============================================================ VENTAS
ventas, items, pagos, venta_vend = [], [], [], []
remitos = {g(r, 0): r for r in R['Venta_General'][1:] if g(r, 0)}

# 1) Remitos (2026 desde el 20/01): con detalle por producto
detalle = collections.defaultdict(list)
for r in R['Venta_Detalle'][1:]:
    if g(r, 0):
        detalle[g(r, 0)].append(r)
# El tablero usa "Monto Recibido" de Compilado. En ventas con Getnet o Mercado Pago ese monto suele ser
# menor que el total del remito. Se toma el de Compilado para que los números coincidan con el tablero
# y se deja anotado el del remito.
cobrado_compilado = collections.defaultdict(float)
for r in V['Compilado'][1:]:
    if g(r, 0) in remitos and monto(g(r, 3)) is not None:
        cobrado_compilado[g(r, 0)] += monto(g(r, 3))
ajustadas = collections.Counter()
for nro, r in remitos.items():
    total_lista, total = monto(g(r, 11)) or 0, monto(g(r, 12)) or 0
    obs, comision = '', 0
    if nro in cobrado_compilado and cobrado_compilado[nro] < total - 1:
        # El cliente pagó el total del remito (eso se factura); a la cuenta entró lo de Compilado.
        comision = round(total - cobrado_compilado[nro], 2)
        ajustadas[MEDIOS.get(g(r, 5).lower(), g(r, 5))] += 1
    elif nro in cobrado_compilado and cobrado_compilado[nro] > total + 1:
        obs = f'El remito decía {total:.2f}; se usa lo cobrado según Compilado'
        total = round(cobrado_compilado[nro], 2)
    ventas.append({'numero': nro, 'fecha': fecha(g(r, 2)), 'canal': canal(g(r, 8)),
                   'cliente_texto': g(r, 6), 'cliente_email': g(r, 7), 'total_lista': total_lista,
                   'total': total, 'origen': 'remitos', 'detalle_texto': g(r, 1), 'observacion': obs})
    for v in vendedores(g(r, 9)):
        venta_vend.append({'venta_numero': nro, 'vendedor': v})
    pagos.append({'venta_numero': nro, 'medio_pago': medio(g(r, 5)), 'monto': total, 'comision': comision,
                  'fecha': fecha(g(r, 2))})
    for d in detalle.get(nro, []):
        items.append({'venta_numero': nro, 'producto_codigo': g(d, 5), 'descripcion': g(d, 4),
                      'cantidad': int(monto(g(d, 6)) or 1), 'precio_lista': monto(g(d, 7)) or 0,
                      'precio_final': monto(g(d, 8)) or 0})

# 2) Compilado (2021 en adelante), sin las que ya vinieron de Remitos
facturas_compilado = []
seq = 0
saltadas = collections.Counter()
for idx, r in enumerate(V['Compilado'][1:], start=2):     # idx = fila de la planilla
    if not any(c.strip() for c in r):
        continue
    nro = g(r, 0)
    if nro in remitos:
        saltadas['ya_en_remitos'] += 1
        continue
    f = fecha(g(r, 4), g(r, 6))
    if not f:
        saltadas['sin_fecha'] += 1
        continue
    seq += 1
    numero = nro if re.fullmatch(r'\d{8}-\d{4}', nro) else f'H-{seq:05d}'
    lista, cobrado = monto(g(r, 2)), monto(g(r, 3))
    mp = medio(g(r, 7))
    recibido = cobrado if cobrado is not None else (lista or 0)
    if mp in CON_COMISION and lista is not None and lista > recibido:
        total_cliente, comision = lista, round(lista - recibido, 2)     # pagó lista; entró menos
    else:
        total_cliente, comision = recibido, 0                           # efectivo/transferencia: descuento al cliente
    ventas.append({'numero': numero, 'fecha': f, 'canal': canal(g(r, 12)), 'cliente_texto': g(r, 11),
                   'cliente_email': '', 'total_lista': lista if lista is not None else recibido,
                   'total': total_cliente, 'origen': 'compilado',
                   'detalle_texto': g(r, 1), 'observacion': f'Compilado fila {idx}',
                   '_fila': idx})
    for v in vendedores(g(r, 13)):
        venta_vend.append({'venta_numero': numero, 'vendedor': v})
    pagos.append({'venta_numero': numero, 'medio_pago': mp, 'monto': total_cliente, 'comision': comision, 'fecha': f})
    nf = g(r, 9)
    m = re.search(r'C(\d{4})-(\d{8})', nf)
    if m and g(r, 10) in ('Joan', 'Sele'):
        facturas_compilado.append({'venta_numero': numero, 'emisor': g(r, 10), 'punto_venta': int(m.group(1)),
                                   'numero': int(m.group(2)), 'fecha': f,
                                   'importe': cobrado if cobrado is not None else lista})
reporte['compilado_saltadas'] = dict(saltadas)
reporte['remitos_con_comision_detectada'] = dict(ajustadas)

numeros_por_fila = {v['_fila']: v['numero'] for v in ventas if v.get('_fila')}
escribir('ventas', ['numero', 'fecha', 'canal', 'cliente_texto', 'cliente_email', 'total_lista', 'total',
                    'origen', 'detalle_texto', 'observacion'], ventas)
escribir('venta_items', ['venta_numero', 'producto_codigo', 'descripcion', 'cantidad', 'precio_lista',
                         'precio_final'], items)
escribir('venta_vendedores', ['venta_numero', 'vendedor'], venta_vend)
escribir('pagos', ['venta_numero', 'medio_pago', 'monto', 'comision', 'fecha'], pagos)
escribir('medios_pago', ['nombre', 'descuento_pct', 'comision_pct', 'usos'],
         [{'nombre': k, 'descuento_pct': DESCUENTO.get(k, 0), 'comision_pct': COMISION.get(k, 0), 'usos': n} for k, n in medios_vistos.most_common()])
escribir('canales', ['nombre', 'usos'], [{'nombre': k, 'usos': n} for k, n in canales_vistos.most_common()])
escribir('vendedores', ['nombre', 'ventas', 'activo'],
         [{'nombre': k, 'ventas': n, 'activo': k != 'Mali'} for k, n in vendedores_vistos.most_common()])

# ============================================================ FACTURAS
facturas = {}
for r in V['Facturacion_Log'][1:]:
    if g(r, 10) != 'OK':
        continue
    m = re.search(r'C(\d{4})-(\d{8})', g(r, 6))
    if not m:
        continue
    fila = int(monto(g(r, 2)) or 0)
    clave = (g(r, 1), int(m.group(1)), int(m.group(2)))
    facturas[clave] = {'venta_numero': numeros_por_fila.get(fila) or (g(r, 3) if g(r, 3) in remitos else ''),
                       'emisor': g(r, 1), 'punto_venta': clave[1], 'numero': clave[2],
                       'fecha': fecha(g(r, 9)), 'importe': monto(g(r, 4)), 'cae': g(r, 7),
                       'cae_vto': (g(r, 8)[:4] + '-' + g(r, 8)[4:6] + '-' + g(r, 8)[6:8]) if len(g(r, 8)) == 8 else '',
                       'receptor_doc_tipo': g(r, 13) or 99, 'receptor_doc_nro': g(r, 14) or '0',
                       'receptor_cond_iva': g(r, 15) or 5, 'receptor_nombre': g(r, 16),
                       'receptor_domicilio': g(r, 17), 'pdf_url': g(r, 12), 'origen': 'facturador'}
desde_compilado = 0
for f in facturas_compilado:
    clave = (f['emisor'], f['punto_venta'], f['numero'])
    if clave in facturas:
        if not facturas[clave]['venta_numero']:
            facturas[clave]['venta_numero'] = f['venta_numero']
        continue
    facturas[clave] = dict(f, cae='', cae_vto='', receptor_doc_tipo=99, receptor_doc_nro='0',
                           receptor_cond_iva=5, receptor_nombre='', receptor_domicilio='', pdf_url='',
                           origen='compilado')
    desde_compilado += 1
escribir('facturas', ['venta_numero', 'emisor', 'punto_venta', 'numero', 'fecha', 'importe', 'cae', 'cae_vto',
                      'receptor_doc_tipo', 'receptor_doc_nro', 'receptor_cond_iva', 'receptor_nombre',
                      'receptor_domicilio', 'pdf_url', 'origen'], list(facturas.values()))
reporte['facturas_desde_compilado_sin_cae'] = desde_compilado

# ============================================================ GASTOS
tipos = collections.OrderedDict()
leyendo = False
for r in T['AJUSTES']:
    celdas = [c.strip() for c in r if c.strip()]
    if celdas[:1] == ['Tipo de gasto (como está en Egresos)']:
        leyendo = True
        continue
    if leyendo and len(celdas) >= 2 and celdas[1] in ('MERCADERIA', 'FIJOS', 'VARIABLES', 'MEJORAS', 'RETIROS'):
        tipos[celdas[0].upper()] = celdas[1].lower()
for r in E['Categoría']:
    if g(r, 0) and g(r, 0).upper() not in tipos:
        tipos[g(r, 0).upper()] = 'variables'
        sin_mapear['tipo_gasto_sin_grupo'][g(r, 0)] += 1

CUENTAS = {'SANTANDER (SELE)': 'Santander (Sele)', 'GALICIA': 'Galicia', 'EFECTIVO': 'Efectivo',
           'MP': 'Mercado Pago', 'CHO EXTRA': 'Cuenta Joan (extra)', 'VENTA': 'Sin dato', '': 'Sin dato'}

def fila_egreso(fe, prov, tipo, imp, cuenta, conc, obs, origen, anio=None):
    t = tipo.strip().upper()
    if t and t not in tipos:
        tipos[t] = 'variables'
        sin_mapear['tipo_gasto_sin_grupo'][t] += 1
    c = CUENTAS.get(cuenta.strip().upper())
    if c is None:
        sin_mapear['cuenta'][cuenta] += 1
        c = cuenta.strip()
    return {'fecha': fecha(fe, anio), 'proveedor': prov.strip(), 'tipo_gasto': t, 'importe': monto(imp),
            'cuenta': c, 'conciliado': conc.strip().lower() == 'si', 'observaciones': obs.strip(), 'origen': origen}

egresos = []
claves = set()
for r in E['Egresos'][1:]:
    if not g(r, 1) or monto(g(r, 6)) is None:
        continue
    e = fila_egreso(g(r, 1), g(r, 4), g(r, 5), g(r, 6), g(r, 7), g(r, 8), g(r, 9), 'migracion', g(r, 3))
    egresos.append(e)
    claves.add((e['proveedor'].lower(), e['importe']))
tg_nuevos = 0
for r in E['Egresos_Telegram'][1:]:
    if not g(r, 1) or monto(g(r, 6)) is None:
        continue
    e = fila_egreso(g(r, 1), g(r, 4), g(r, 5), g(r, 6), g(r, 7), g(r, 8), g(r, 9), 'telegram')
    if (e['proveedor'].lower(), e['importe']) in claves:
        continue
    egresos.append(e); tg_nuevos += 1
reporte['telegram_que_faltaban_en_egresos'] = tg_nuevos
escribir('egresos', ['fecha', 'proveedor', 'tipo_gasto', 'importe', 'cuenta', 'conciliado', 'observaciones',
                     'origen'], egresos)

cho = []
for r in E['EGRESOS CHO EXTRA'][1:]:
    if not g(r, 0) or monto(g(r, 5)) is None:
        continue
    cho.append(fila_egreso(g(r, 0), g(r, 3), g(r, 4), g(r, 5), 'CHO EXTRA', '', g(r, 7), 'migracion', g(r, 2)))
escribir('egresos_cuenta_joan_extra', ['fecha', 'proveedor', 'tipo_gasto', 'importe', 'cuenta', 'conciliado',
                                       'observaciones', 'origen'], cho)
escribir('tipos_gasto', ['nombre', 'grupo'], [{'nombre': k, 'grupo': v} for k, v in tipos.items()])

# ============================================================ CAJA
cierres = []
for r in R['Cierre_Logs'][1:]:
    if g(r, 1):
        cierres.append({'fecha': fecha(g(r, 1)), 'origen_planilla': g(r, 2), 'cierre_del_dia': g(r, 3),
                        'cant_ventas': g(r, 4), 'cant_items': g(r, 5), 'total_lista': monto(g(r, 6)),
                        'total_final': monto(g(r, 7)), 'detalle': g(r, 8)})
escribir('cierres_caja', ['fecha', 'origen_planilla', 'cierre_del_dia', 'cant_ventas', 'cant_items',
                          'total_lista', 'total_final', 'detalle'], cierres)

# ============================================================ REPORTE
reporte['sin_mapear'] = {k: dict(v) for k, v in sin_mapear.items()}
reporte['montos_raros'] = dict(montos_raros)
reporte['fechas_sin_anio_completadas'] = dict(fechas_sin_anio)
with open(os.path.join(OUT, 'reporte_migracion.json'), 'w', encoding='utf-8') as f:
    json.dump(reporte, f, ensure_ascii=False, indent=2)
print(json.dumps(reporte, ensure_ascii=False, indent=2))
