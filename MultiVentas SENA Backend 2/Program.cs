using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using MultiVentasPOS.Data;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// ============================================
// 1. BASE DE DATOS (Entity Framework Core)
// ============================================
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// ============================================
// 2. CONTROLADORES (solo API, sin vistas Razor)
// ============================================
builder.Services.AddControllers();

// ============================================
// 3. CORS (para que el front HTML/JS pueda consumir la API)
// ============================================
builder.Services.AddCors(options =>
{
    options.AddPolicy("PermitirFront", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod()
              .WithExposedHeaders(
                  "X-Total-Count",
                  "X-Page",
                  "X-Page-Size",
                  "X-Total-Pages"
              );   // 🆕 exponer headers personalizados
    });
});

// ============================================
// 4. AUTENTICACIÓN JWT
// ============================================
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Jwt:Key no está configurada en appsettings.json");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization();

// ============================================
// 5. SWAGGER con soporte JWT
// ============================================
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "MultiVentasPOS API",
        Version = "v1",
        Description = "API REST para el sistema POS MultiVentas - Proyecto SENA",
        Contact = new OpenApiContact
        {
            Name = "MultiVentas",
            Email = "soporte@multiventas.com"
        }
    });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Pega SOLO el token JWT (sin la palabra 'Bearer')."
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// ============================================
// 6. LÍMITES PARA SUBIDA DE ARCHIVOS (importación masiva)
//    ⚠️ ESTO VA ANTES DE builder.Build()
// ============================================
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 20_000_000;   // 20 MB
});

// ============================================
// 7. CONSTRUIR LA APP
//    ⚠️ A PARTIR DE AQUÍ YA NO SE TOCAN builder.Services
// ============================================
var app = builder.Build();

// ============================================
// 8. PIPELINE HTTP
// ============================================

// Swagger (siempre habilitado en desarrollo)
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "MultiVentasPOS API v1");
        c.RoutePrefix = "swagger";
    });
}

// Orden IMPORTANTE:
app.UseCors("PermitirFront");     // 1. CORS primero
app.UseAuthentication();          // 2. Autenticación
app.UseAuthorization();           // 3. Autorización

app.MapControllers();             // 4. Rutas de controladores

app.Run();