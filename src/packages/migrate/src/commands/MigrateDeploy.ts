import {
  arg,
  Command,
  format,
  getSchemaPath,
  HelpError,
  isError,
  getCommandWithExecutor,
} from '@prisma/sdk'
import chalk from 'chalk'
import path from 'path'
import { Migrate } from '../Migrate'
import { ensureDatabaseExists, getDbInfo } from '../utils/ensureDatabaseExists'
import {
  EarlyAcessFlagError,
  ExperimentalFlagWithNewMigrateError,
} from '../utils/flagErrors'
import { NoSchemaFoundError } from '../utils/errors'
import { printFilesFromMigrationIds } from '../utils/printFiles'
import { throwUpgradeErrorIfOldMigrate } from '../utils/detectOldMigrate'
import Debug from '@prisma/debug'

const debug = Debug('migrate:deploy')

export class MigrateDeploy implements Command {
  public static new(): MigrateDeploy {
    return new MigrateDeploy()
  }

  private static help = format(`
Apply migrations to update the database schema in staging/production

${chalk.bold.yellow('WARNING')} ${chalk.bold(
    "Prisma's migration functionality is currently in Early Access.",
  )}
${chalk.dim(
  'When using any of the commands below you need to explicitly opt-in via the --early-access-feature flag.',
)}

${chalk.bold('Usage')}

  ${chalk.dim('$')} prisma migrate deploy [options] --early-access-feature

${chalk.bold('Options')}

  -h, --help   Display this help message
    --schema   Custom path to your Prisma schema
`)

  public async parse(argv: string[]): Promise<string | Error> {
    const args = arg(
      argv,
      {
        '--help': Boolean,
        '-h': '--help',
        '--experimental': Boolean,
        '--early-access-feature': Boolean,
        '--schema': String,
        '--telemetry-information': String,
      },
      false,
    )

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    if (args['--experimental']) {
      throw new ExperimentalFlagWithNewMigrateError()
    }

    if (!args['--early-access-feature']) {
      throw new EarlyAcessFlagError()
    }

    const schemaPath = await getSchemaPath(args['--schema'])

    if (!schemaPath) {
      throw new NoSchemaFoundError()
    }

    console.info(
      chalk.dim(
        `Prisma schema loaded from ${path.relative(process.cwd(), schemaPath)}`,
      ),
    )

    const dbInfo = await getDbInfo(schemaPath)
    console.info(
      chalk.dim(
        `Datasource "${dbInfo.name}": ${dbInfo.dbType} ${dbInfo.schemaWord} "${dbInfo.dbName}" at "${dbInfo.dbLocation}"`,
      ),
    )

    throwUpgradeErrorIfOldMigrate(schemaPath)

    const migrate = new Migrate(schemaPath)

    // Automatically create the database if it doesn't exist
    const wasDbCreated = await ensureDatabaseExists('apply', true, schemaPath)
    if (wasDbCreated) {
      console.info() // empty line
      console.info(wasDbCreated)
    }

    const diagnoseResult = await migrate.diagnoseMigrationHistory({
      optInToShadowDatabase: false,
    })
    debug({ diagnoseResult })

    const listMigrationDirectoriesResult = await migrate.listMigrationDirectories()
    debug({ listMigrationDirectoriesResult })

    console.info() // empty line
    if (listMigrationDirectoriesResult.migrations.length > 0) {
      const migrations = listMigrationDirectoriesResult.migrations
      console.info(
        `${migrations.length} migration${
          migrations.length > 1 ? 's' : ''
        } found in prisma/migrations`,
      )
    } else {
      console.info(`No migration found in prisma/migrations`)
    }

    const editedMigrationNames = diagnoseResult.editedMigrationNames
    if (editedMigrationNames.length > 0) {
      console.info(
        `${chalk.yellow(
          'WARNING The following migrations have been modified since they were applied:',
        )}
${editedMigrationNames.join('\n')}`,
      )
    }

    const {
      appliedMigrationNames: migrationIds,
    } = await migrate.applyMigrations()

    migrate.stop()

    console.info() // empty line
    if (migrationIds.length === 0) {
      return chalk.greenBright(`No pending migrations to apply.`)
    } else {
      return `The following migration${
        migrationIds.length > 1 ? 's' : ''
      } have been applied:\n\n${chalk(
        printFilesFromMigrationIds('migrations', migrationIds, {
          'migration.sql': '',
        }),
      )}
      
${chalk.greenBright('All migrations have been successfully applied.')}`
    }
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(
        `\n${chalk.bold.red(`!`)} ${error}\n${MigrateDeploy.help}`,
      )
    }
    return MigrateDeploy.help
  }
}
