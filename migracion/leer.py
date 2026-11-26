import csv,io,re
U='/mnt/user-data/uploads/'
FILES={'ventas':U+'7036e016-Ventas','remitos':U+'d29907da-202601_Remitos_-_Ventas','tablero':U+'61034c5e-Cambios_Dorados___Tablero_de_gesti_n','egresos':U+'de3f9c42-Egresos'}
def sheets(key):
    txt=open(FILES[key],encoding='utf-8').read()
    parts=re.split(r'^## Sheet name: (.*)$',txt,flags=re.M)
    return {parts[i].strip():list(csv.reader(io.StringIO(parts[i+1].strip('\n')))) for i in range(1,len(parts),2)}
