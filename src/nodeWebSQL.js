import customOpenDatabase from 'websql/custom';
import SQLiteDatabase from 'websql/BetterSQLiteDatabase';
import CFG from './CFG';

function wrappedSQLiteDatabase (name) {
    const {busyTimeout, sqlTrace, sqlProfile} = CFG;
    return new SQLiteDatabase(name, {
        busyTimeout, sqlTrace, sqlProfile
    });
}

const nodeWebSQL = customOpenDatabase(wrappedSQLiteDatabase);
export default nodeWebSQL;
