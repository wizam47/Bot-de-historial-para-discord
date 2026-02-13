// =============================================
// Configuración inicial y dependencias
// =============================================
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json');
const express = require('express')

// =============================================
// Configuración de Firebase
// =============================================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://bot-de-lectura-de-mensajes-default-rtdb.firebaseio.com/'
});

const db = admin.database();

// =============================================
// Inicializar cliente de Discord
// =============================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// =============================================
// Variables globales
// =============================================
const mensajesPorServidor = {}; // Objeto para almacenar los mensajes por servidor y usuario

// IDs de los roles específicos que quieres monitorear
const rolesEspecificos = {
  staff: '1261154610123378750',
  mod: '1363960731854311647',
  admin: '1130605745755398154'
};

// =============================================
// Comandos slash
// =============================================
const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Muestra las estadísticas de mensajes de un rol específico.')
    .addStringOption(option =>
      option.setName('rol')
        .setDescription('Selecciona el rol para ver las estadísticas')
        .setRequired(true)
        .addChoices(
          { name: 'Staff', value: 'staff' },
          { name: 'Mod', value: 'mod' },
          { name: 'Admin', value: 'admin' }
        )
    )
    .addStringOption(option =>
      option.setName('tipo')
        .setDescription('Selecciona el tipo de estadística')
        .setRequired(true)
        .addChoices(
          { name: 'Diario', value: 'diario' },
          { name: 'Semanal', value: 'semanal' }
        )
    )
    .toJSON(),

  // Comando /historial
  new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Muestra el historial detallado de mensajes de un rol específico en las últimas 4 semanas.')
    .addStringOption(option =>
      option.setName('rol')
        .setDescription('Selecciona el rol para ver el historial')
        .setRequired(true)
        .addChoices(
          { name: 'Staff', value: 'staff' },
          { name: 'Mod', value: 'mod' },
          { name: 'Admin', value: 'admin' }
        )
    )
    .toJSON()
];

// =============================================
// Funciones auxiliares para el historial
// =============================================
function formatDate(date) {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getDayName(date) {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return days[date.getDay()];
}

function getLast4Weeks() {
  const weeks = [];
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));

  for (let i = 0; i < 4; i++) {
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - today.getDay() - 7 * i);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    weeks.push({
      start: formatDate(new Date(startDate)),
      end: formatDate(new Date(endDate)),
      startObj: new Date(startDate),
      endObj: new Date(endDate.setHours(23, 59, 59, 999))
    });
  }
  return weeks;
}

// =============================================
// Evento: Bot conectado
// =============================================
client.on('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  // Cargar datos desde Firebase al iniciar
  const ref = db.ref('servidores');
  ref.once('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      Object.keys(data).forEach(guildId => {
        if (!mensajesPorServidor[guildId]) {
          mensajesPorServidor[guildId] = {};
        }
        if (data[guildId].usuarios) {
          Object.keys(data[guildId].usuarios).forEach(userId => {
            const userData = data[guildId].usuarios[userId];
            if (!mensajesPorServidor[guildId][userId]) {
              mensajesPorServidor[guildId][userId] = {
                diario: 0,
                semanal: { lunes: 0, martes: 0, miércoles: 0, jueves: 0, viernes: 0, sábado: 0, domingo: 0 }
              };
            }

            // Cargar datos diarios
            if (userData.estadisticas && userData.estadisticas.diario) {
              const today = new Date().toISOString().split('T')[0];
              const lastDate = Object.keys(userData.estadisticas.diario).sort().reverse()[0];
              if (lastDate === today) {
                mensajesPorServidor[guildId][userId].diario = userData.estadisticas.diario[lastDate] || 0;
              }
            }

            // Cargar datos semanales
            if (userData.estadisticas && userData.estadisticas.semanal) {
              Object.keys(userData.estadisticas.semanal).forEach(day => {
                mensajesPorServidor[guildId][userId].semanal[day] = userData.estadisticas.semanal[day] || 0;
              });
            }
          });
        }
      });
    }
  });

  // Registrar comandos slash globalmente
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('Registrando comandos slash globalmente...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Comandos registrados con éxito.');
  } catch (error) {
    console.error('Error al registrar comandos:', error);
  }
});

// =============================================
// Evento: Mensaje creado
// =============================================
client.on('messageCreate', (message) => {
  if (message.author.bot || !message.guild || !message.member) return;

  const { guild, author } = message;
  const guildId = guild.id;
  const userId = author.id;
  const currentDay = new Date().toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' }).toLowerCase();
  const currentDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })).toISOString().split('T')[0];

  // Inicializar el objeto para este servidor si no existe
  if (!mensajesPorServidor[guildId]) {
    mensajesPorServidor[guildId] = {};
  }

  // Inicializar el objeto para este usuario si no existe
  if (!mensajesPorServidor[guildId][userId]) {
    mensajesPorServidor[guildId][userId] = {
      diario: 0,
      semanal: {
        lunes: 0,
        martes: 0,
        miércoles: 0,
        jueves: 0,
        viernes: 0,
        sábado: 0,
        domingo: 0
      }
    };
  }

  // Verificar si el usuario tiene alguno de los roles específicos
  const usuarioTieneRol = Object.values(rolesEspecificos).some(roleId =>
    message.member.roles.cache.has(roleId)
  );

  if (usuarioTieneRol) {
    // Incrementar contadores para este usuario
    mensajesPorServidor[guildId][userId].diario++;
    mensajesPorServidor[guildId][userId].semanal[currentDay]++;

    // Guardar en Firebase
    const ref = db.ref(`servidores/${guildId}/usuarios/${userId}/estadisticas`);
    ref.update({
      [`diario/${currentDate}`]: mensajesPorServidor[guildId][userId].diario,
      [`semanal/${currentDay}`]: mensajesPorServidor[guildId][userId].semanal[currentDay]
    });
  }
});

// =============================================
// Evento: Interacción con comando slash
// =============================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    // =============================================
    // Manejo del comando /stats
    // =============================================
    if (interaction.commandName === 'stats') {
      const { guild, options } = interaction;
      const rolSeleccionado = options.getString('rol');
      const tipoEstadistica = options.getString('tipo');

      // Obtener la ID del rol seleccionado
      const rolId = rolesEspecificos[rolSeleccionado];
      if (!rolId) {
        return interaction.reply(`❌ El rol "${rolSeleccionado}" no está configurado correctamente.`);
      }

      // Obtener el objeto del rol usando la ID
      const rol = guild.roles.cache.get(rolId);
      if (!rol) {
        return interaction.reply(`❌ El rol "${rolSeleccionado}" no existe en este servidor.`);
      }

      // Obtener miembros con el rol seleccionado usando la caché
      const miembrosFiltrados = guild.members.cache.filter(m => m.roles.cache.has(rolId));

      // Inicializar el objeto de mensajes para este servidor si no existe
      if (!mensajesPorServidor[guild.id]) {
        mensajesPorServidor[guild.id] = {};
      }

      if (tipoEstadistica === 'diario') {
        // Contar mensajes diarios de cada usuario con el rol seleccionado
        const estadisticas = [];
        miembrosFiltrados.forEach(miembro => {
          const userId = miembro.user.id;
          if (!mensajesPorServidor[guild.id][userId]) {
            mensajesPorServidor[guild.id][userId] = { diario: 0, semanal: { lunes: 0, martes: 0, miércoles: 0, jueves: 0, viernes: 0, sábado: 0, domingo: 0 } };
          }
          estadisticas.push({
            usuario: miembro.user.tag,
            mensajesHoy: mensajesPorServidor[guild.id][userId].diario
          });
        });

        // Ordenar por cantidad de mensajes (de mayor a menor)
        estadisticas.sort((a, b) => b.mensajesHoy - a.mensajesHoy);

        // Crear el mensaje de respuesta para estadísticas diarias
        let respuesta = `**Estadísticas diarias de mensajes para el rol ${rol.name}:**\n`;
        if (estadisticas.length === 0) {
          respuesta += "No han enviado mensajes hoy.";
        } else {
          estadisticas.forEach(estadistica => {
            respuesta += `- **${estadistica.usuario}**: ${estadistica.mensajesHoy} mensajes\n`;
          });
        }

        await interaction.reply(respuesta);

      } else if (tipoEstadistica === 'semanal') {
        // Contar mensajes semanales de cada usuario con el rol seleccionado
        const diasSemana = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
        const estadisticasPorDia = {};

        // Inicializar el objeto de estadísticas por día
        diasSemana.forEach(dia => {
          estadisticasPorDia[dia] = [];
        });

        // Llenar las estadísticas por día
        miembrosFiltrados.forEach(miembro => {
          const userId = miembro.user.id;
          if (!mensajesPorServidor[guild.id][userId]) {
            mensajesPorServidor[guild.id][userId] = { diario: 0, semanal: { lunes: 0, martes: 0, miércoles: 0, jueves: 0, viernes: 0, sábado: 0, domingo: 0 } };
          }

          diasSemana.forEach(dia => {
            const mensajesDia = mensajesPorServidor[guild.id][userId].semanal[dia];
            if (mensajesDia > 0) {
              estadisticasPorDia[dia].push({
                usuario: miembro.user.tag,
                mensajes: mensajesDia
              });
            }
          });
        });

        // Crear el mensaje de respuesta para estadísticas semanales
        let respuesta = `**Estadísticas semanales de mensajes para el rol ${rol.name}:**\n`;

        diasSemana.forEach(dia => {
          const estadisticasDia = estadisticasPorDia[dia];
          if (estadisticasDia.length > 0) {
            respuesta += `\n**${dia.charAt(0).toUpperCase() + dia.slice(1)}:**\n`;
            estadisticasDia.forEach(estadistica => {
              respuesta += `- **${estadistica.usuario}**: ${estadistica.mensajes} mensajes\n`;
            });
          }
        });

        if (respuesta === `**Estadísticas semanales de mensajes para el rol ${rol.name}:**\n`) {
          respuesta += "No hay mensajes registrados esta semana para este rol.";
        }

        await interaction.reply(respuesta);
      }
    }
    // =============================================
    // Manejo del comando /historial (versión mejorada con espacios entre semanas)
    // =============================================
    else if (interaction.commandName === 'historial') {
      await interaction.deferReply();

      const { guild, options } = interaction;
      const rolSeleccionado = options.getString('rol');

      // Obtener la ID del rol seleccionado
      const rolId = rolesEspecificos[rolSeleccionado];
      if (!rolId) {
        return interaction.editReply(`❌ El rol "${rolSeleccionado}" no está configurado correctamente.`);
      }

      // Obtener el objeto del rol usando la ID
      const rol = guild.roles.cache.get(rolId);
      if (!rol) {
        return interaction.editReply(`❌ El rol "${rolSeleccionado}" no existe en este servidor.`);
      }

      // Obtener miembros con el rol seleccionado usando la caché
      const miembrosFiltrados = guild.members.cache.filter(m => m.roles.cache.has(rolId));

      if (miembrosFiltrados.size === 0) {
        return interaction.editReply(`No hay miembros con el rol ${rol.name} en este servidor.`);
      }

      // Mensaje inicial
      await interaction.editReply({
        content: `📋 **Historial detallado de mensajes para el rol ${rol.name} (últimas 4 semanas):**\n\n` +
                 `Se han encontrado datos para ${miembrosFiltrados.size} miembro(s). ` +
                 `Los detalles se muestran a continuación.`
      });

      // Consulta a Firebase
      const ref = db.ref(`servidores/${guild.id}/usuarios`);
      ref.once('value', async (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          return interaction.followUp("No hay datos históricos disponibles.");
        }

        // Procesar cada miembro individualmente
        for (const miembro of miembrosFiltrados.values()) {
          const userId = miembro.user.id;
          const userData = data[userId]?.estadisticas;

          if (!userData) continue;

          // Crear un embed para este miembro
          const embed = {
            color: 0xD2B04C, // Color dorado claro
            title: `📊 Historial de mensajes - ${miembro.user.tag}`,
            description: `Rol: **${rol.name}**\nPeríodo: **Últimas 4 semanas**\n\n` +
                         `A continuación se detallan los mensajes enviados cada día:`,
            fields: [],
            timestamp: new Date(),
          };

          // Obtener las fechas de las últimas 4 semanas
          const weeks = getLast4Weeks();

          // Procesar cada semana
          for (let i = 0; i < weeks.length; i++) {
            const week = weeks[i];
            let weekTotal = 0;
            const daysOfWeek = [];

            // Obtener todos los días de la semana
            let currentDate = new Date(week.startObj);

            while (currentDate <= week.endObj) {
              const dateStr = currentDate.toISOString().split('T')[0];
              const dayName = getDayName(new Date(currentDate));
              const dailyMessages = userData.diario?.[dateStr] || 0;
              weekTotal += dailyMessages;

              daysOfWeek.push({
                name: dayName,
                messages: dailyMessages
              });

              currentDate.setDate(currentDate.getDate() + 1);
            }

            // Crear el campo para esta semana
            const weekField = {
              name: `📅 ${week.start} - ${week.end}`,
              value: daysOfWeek.map(day => `**${day.name}**: ${day.messages} mensajes`).join('\n') +
                     `\n📊 **Total semanal**: ${weekTotal} mensajes`,
              inline: false
            };

            embed.fields.push(weekField);

            // Añadir un separador visual si no es la última semana
            if (i < weeks.length - 1) {
              embed.fields.push({
                name: '─',
                value: '─',
                inline: false
              });
            }
          }

          // Enviar el embed para este miembro
          await interaction.followUp({ embeds: [embed] });
        }
      }).catch(error => {
        console.error("Error al obtener datos de Firebase:", error);
        interaction.followUp("Ocurrió un error al obtener los datos históricos.");
      });
    }
  } catch (error) {
    console.error('Error en interactionCreate:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Ocurrió un error al procesar el comando.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Ocurrió un error al procesar el comando.', ephemeral: true });
    }
  }
});

// =============================================
// Reiniciar contadores diarios cada 24 horas
// =============================================
setInterval(() => {
  for (const guildId in mensajesPorServidor) {
    for (const userId in mensajesPorServidor[guildId]) {
      mensajesPorServidor[guildId][userId].diario = 0;
    }
  }
  console.log('Contadores diarios reiniciados en todos los servidores');
}, 24 * 60 * 60 * 1000);

// =============================================
// Reiniciar contadores semanales cada 7 días
// =============================================
setInterval(() => {
  for (const guildId in mensajesPorServidor) {
    for (const userId in mensajesPorServidor[guildId]) {
      mensajesPorServidor[guildId][userId].semanal = {
        lunes: 0,
        martes: 0,
        miércoles: 0,
        jueves: 0,
        viernes: 0,
        sábado: 0,
        domingo: 0
      };
    }
  }
  console.log('Contadores semanales reiniciados en todos los servidores');
}, 7 * 24 * 60 * 60 * 1000);

// =============================================
// Manejo de errores no capturados
// =============================================
client.on('error', (error) => {
  console.error('Error en el cliente de Discord:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

// =============================================
// Configuración para Render
// =============================================
const PORT = process.env.PORT || 3000;
const app = express();

app.get('/', (req, res) => {
  res.send('Bot de Discord en funcionamiento');
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

// =============================================
// Iniciar sesión con el bot
// =============================================
client.login(process.env.TOKEN);
