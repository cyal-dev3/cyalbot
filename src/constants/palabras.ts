export const PALABRAS_CATEGORIAS = ['animales', 'paises', 'frutas', 'profesiones', 'deportes', 'objetos', 'comida', 'ciencia', 'musica', 'naturaleza'] as const;

export type PalabraCategoria = (typeof PALABRAS_CATEGORIAS)[number];

export interface Palabra {
  palabra: string;
  pista: string;
  categoria: PalabraCategoria;
}

function lista(categoria: PalabraCategoria, items: [string, string][]): Palabra[] {
  return items.map(([palabra, pista]) => ({ palabra, pista, categoria }));
}

/** Banco local de respaldo para el ahorcado (sin tildes para adivinar letra a letra). */
export const PALABRAS: Palabra[] = [
  ...lista('animales', [
    ['elefante', 'El mamífero terrestre más grande'], ['jirafa', 'Tiene el cuello más largo'], ['cocodrilo', 'Reptil de río con muchos dientes'],
    ['murcielago', 'Único mamífero que vuela'], ['pinguino', 'Ave que nada pero no vuela'], ['ardilla', 'Roedor que guarda nueces'],
    ['tortuga', 'Lleva su casa encima'], ['canguro', 'Salta y tiene bolsa marsupial'], ['delfin', 'Mamífero marino muy inteligente'],
    ['camello', 'Guarda grasa en sus jorobas'], ['flamenco', 'Ave rosada de patas largas'], ['tiburon', 'Depredador del mar con aletas'],
    ['hormiga', 'Insecto que vive en colonias'], ['lechuza', 'Ave nocturna de ojos grandes'], ['caballo', 'Se monta y galopa'],
  ]),
  ...lista('paises', [
    ['argentina', 'País del tango y la carne asada'], ['canada', 'País de la hoja de maple'], ['japon', 'País del sol naciente'],
    ['egipto', 'País de las pirámides de Giza'], ['australia', 'País de los canguros'], ['brasil', 'País del carnaval de Río'],
    ['alemania', 'País de la cerveza y el Oktoberfest'], ['colombia', 'País del café y Shakira'], ['italia', 'País con forma de bota'],
    ['noruega', 'País nórdico de los fiordos'], ['portugal', 'Vecino occidental de España'], ['tailandia', 'País del sudeste asiático con playas famosas'],
    ['marruecos', 'País del norte de África frente a España'], ['grecia', 'Cuna de la democracia y la mitología olímpica'], ['chile', 'País largo y angosto de Sudamérica'],
  ]),
  ...lista('frutas', [
    ['sandia', 'Grande, verde por fuera y roja por dentro'], ['platano', 'Amarilla y curva'], ['mango', 'Tropical, muy dulce y con hueso grande'],
    ['fresa', 'Roja, pequeña y con semillas por fuera'], ['pina', 'Con corona de hojas y piel con picos'], ['durazno', 'De piel aterciopelada'],
    ['cereza', 'Pequeña, roja y con tallo'], ['granada', 'Llena de semillas rojas'], ['papaya', 'Tropical, naranja y con semillas negras'],
    ['guayaba', 'Fruta pequeña, aromática y rica en vitamina C'], ['mandarina', 'Cítrico fácil de pelar'], ['coco', 'Fruta dura con agua dentro'],
    ['uva', 'Crece en racimos y da vino'], ['kiwi', 'Verde por dentro con piel peluda'], ['limon', 'Cítrico muy ácido'],
  ]),
  ...lista('profesiones', [
    ['bombero', 'Apaga incendios'], ['arquitecto', 'Diseña edificios'], ['enfermera', 'Cuida pacientes en el hospital'],
    ['carpintero', 'Trabaja la madera'], ['abogado', 'Defiende casos en juicios'], ['piloto', 'Conduce aviones'],
    ['panadero', 'Hace pan'], ['veterinario', 'Médico de animales'], ['electricista', 'Instala y repara cables'],
    ['periodista', 'Escribe noticias'], ['astronauta', 'Viaja al espacio'], ['mecanico', 'Repara autos'],
    ['jardinero', 'Cuida plantas y jardines'], ['dentista', 'Cuida los dientes'], ['chef', 'Cocina en restaurantes'],
  ]),
  ...lista('deportes', [
    ['futbol', 'El más popular del mundo, se juega con los pies'], ['natacion', 'Se practica en el agua'], ['ciclismo', 'Se practica sobre dos ruedas'],
    ['boxeo', 'Se pelea con guantes en un ring'], ['atletismo', 'Correr, saltar y lanzar'], ['gimnasia', 'Acrobacias y equilibrio'],
    ['esgrima', 'Se usa un florete o sable'], ['surf', 'Sobre las olas con una tabla'], ['voleibol', 'La pelota pasa sobre una red alta'],
    ['beisbol', 'Se batea y se corren bases'], ['tenis', 'Raqueta, red y pelota amarilla'], ['karate', 'Arte marcial japonés'],
    ['golf', 'Meter la bola en 18 hoyos'], ['ajedrez', 'Deporte mental con rey y reina'], ['rugby', 'Balón ovalado y melés'],
  ]),
  ...lista('objetos', [
    ['paraguas', 'Te protege de la lluvia'], ['bicicleta', 'Vehículo de dos ruedas y pedales'], ['cuchara', 'Sirve para tomar sopa'],
    ['telefono', 'Sirve para llamar'], ['almohada', 'Apoyas la cabeza al dormir'], ['linterna', 'Da luz portátil'],
    ['escalera', 'Sirve para subir'], ['espejo', 'Refleja tu imagen'], ['martillo', 'Clava clavos'],
    ['mochila', 'Se carga en la espalda'], ['tijeras', 'Cortan papel'], ['reloj', 'Marca la hora'],
    ['ventana', 'Deja entrar la luz a la casa'], ['candado', 'Cierra con llave'], ['brujula', 'Señala el norte'],
  ]),
  ...lista('comida', [
    ['tamal', 'Masa envuelta en hoja de maíz o plátano'], ['pizza', 'Redonda, con queso y salsa de tomate'], ['empanada', 'Masa rellena y doblada'],
    ['ceviche', 'Pescado crudo marinado en limón'], ['hamburguesa', 'Carne entre dos panes'], ['chocolate', 'Dulce hecho de cacao'],
    ['arepa', 'Pan de maíz venezolano y colombiano'], ['sushi', 'Arroz japonés con pescado'], ['guacamole', 'Salsa de aguacate'],
    ['paella', 'Arroz español con azafrán'], ['enchilada', 'Tortilla bañada en salsa de chile'], ['churro', 'Masa frita con azúcar'],
    ['lasagna', 'Capas de pasta, carne y queso'], ['tacos', 'Tortilla con relleno, platillo mexicano'], ['helado', 'Postre frío y cremoso'],
  ]),
  ...lista('ciencia', [
    ['gravedad', 'Fuerza que nos mantiene en el suelo'], ['molecula', 'Conjunto de átomos unidos'], ['planeta', 'Gira alrededor de una estrella'],
    ['volcan', 'Montaña que escupe lava'], ['oxigeno', 'Gas que respiramos'], ['electron', 'Partícula con carga negativa'],
    ['telescopio', 'Sirve para ver las estrellas'], ['bacteria', 'Microorganismo unicelular'], ['fotosintesis', 'Proceso con el que las plantas producen alimento'],
    ['galaxia', 'Conjunto de miles de millones de estrellas'], ['vacuna', 'Prepara al cuerpo contra una enfermedad'], ['iman', 'Atrae el hierro'],
    ['cometa', 'Cuerpo celeste con cola brillante'], ['neurona', 'Célula del sistema nervioso'], ['energia', 'Capacidad de producir trabajo'],
  ]),
  ...lista('musica', [
    ['guitarra', 'Instrumento de seis cuerdas'], ['bateria', 'Instrumento de percusión con platillos'], ['violin', 'Se toca con un arco'],
    ['trompeta', 'Instrumento de viento metálico'], ['piano', 'Tiene teclas blancas y negras'], ['acordeon', 'Se estira y comprime para sonar'],
    ['saxofon', 'Instrumento del jazz, metálico y curvo'], ['flauta', 'Se sopla y tiene agujeros'], ['mariachi', 'Conjunto musical tradicional mexicano'],
    ['reggaeton', 'Género urbano latino'], ['cumbia', 'Ritmo bailable de origen colombiano'], ['orquesta', 'Gran conjunto de músicos con director'],
    ['melodia', 'Sucesión de notas que se recuerda'], ['tambor', 'Se golpea con baquetas o manos'], ['arpa', 'Instrumento de cuerdas verticales'],
  ]),
  ...lista('naturaleza', [
    ['cascada', 'Caída de agua desde lo alto'], ['desierto', 'Lugar seco con arena'], ['arcoiris', 'Aparece tras la lluvia con siete colores'],
    ['tormenta', 'Lluvia fuerte con rayos'], ['bosque', 'Lleno de árboles'], ['glaciar', 'Masa de hielo que se mueve lento'],
    ['isla', 'Tierra rodeada de agua'], ['montana', 'Elevación grande del terreno'], ['rio', 'Corriente de agua que va al mar'],
    ['selva', 'Vegetación densa y húmeda'], ['terremoto', 'Sacudida de la tierra'], ['huracan', 'Tormenta giratoria enorme'],
    ['pradera', 'Llanura de pasto'], ['cueva', 'Hueco natural en la roca'], ['oceano', 'Gran masa de agua salada'],
  ]),
];
