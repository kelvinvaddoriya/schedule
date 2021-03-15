package com.example.schedule

import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.android.volley.RequestQueue
import com.android.volley.toolbox.Volley
import kotlinx.android.synthetic.main.activity_main.*
import java.text.SimpleDateFormat
import java.util.*
import kotlin.collections.ArrayList


class MainActivity : AppCompatActivity() {

    private lateinit var requestQueue : RequestQueue
    private lateinit var adapter: DataAdapter
    private lateinit var arrayList: ArrayList<DataStu>

    //Spinner val
    private val area = arrayOf("Area" ,"One" ,"Two" ,"Three" ,"Four" ,"Five")
    private val type = arrayOf("Type" ,"A" ,"B" ,"C" ,"D" ,"E")
    private val time = arrayOf("Time" ,"Morning" ,"Afternoon" ,"Evening" ,"Night" ,"Late night")
    private val classA = arrayOf("Class" ,"1st" ,"2nd" ,"3rd" ,"4th" ,"5th")
    private val instructor = arrayOf("Instructor" ,"Beginner" ,"Intermediate" ,"Expert" ,"Pro" ,"Conqueror")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        //Spinners array
        val arrayAdapterArea = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,area)
        val arrayAdapterType = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,type)
        val arrayAdapterTime = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,time)
        val arrayAdapterClass = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,classA)
        val arrayAdapterInstructor = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,instructor)

        //Spinners Adapter
        spinnerArea.adapter = arrayAdapterArea
        spinnerType.adapter = arrayAdapterType
        spinnerTime.adapter = arrayAdapterTime
        spinnerClass.adapter = arrayAdapterClass
        spinnerInstructor.adapter = arrayAdapterInstructor

        //Spinner Selection
        spinnerArea.onItemSelectedListener = object: AdapterView.OnItemSelectedListener{
            override fun onItemSelected(parent: AdapterView<*>? , view: View? , position: Int , id: Long) {
                    if (parent?.getItemAtPosition(position)?.equals("Area") == true)
                    {
                            Toast.makeText(this@MainActivity,"Please select Area",Toast.LENGTH_SHORT).show()
                    }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {

            }
        }
        spinnerType.onItemSelectedListener = object: AdapterView.OnItemSelectedListener{
            override fun onItemSelected(parent: AdapterView<*>? , view: View? , position: Int , id: Long) {
                if (parent?.getItemAtPosition(position)?.equals("Type") == true)
                {
                    Toast.makeText(this@MainActivity,"Please select Type",Toast.LENGTH_SHORT).show()
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {

            }
        }
        spinnerTime.onItemSelectedListener = object: AdapterView.OnItemSelectedListener{
            override fun onItemSelected(parent: AdapterView<*>? , view: View? , position: Int , id: Long) {
                if (parent?.getItemAtPosition(position)?.equals("Time") == true)
                {
                    Toast.makeText(this@MainActivity,"Please select Time",Toast.LENGTH_SHORT).show()
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {

            }
        }
        spinnerClass.onItemSelectedListener = object: AdapterView.OnItemSelectedListener{
            override fun onItemSelected(parent: AdapterView<*>? , view: View? , position: Int , id: Long) {
                if (parent?.getItemAtPosition(position)?.equals("Class") == true)
                {
                    Toast.makeText(this@MainActivity,"Please select Class",Toast.LENGTH_SHORT).show()
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {

            }
        }
        spinnerInstructor.onItemSelectedListener = object: AdapterView.OnItemSelectedListener{
            override fun onItemSelected(parent: AdapterView<*>? , view: View? , position: Int , id: Long) {
                if (parent?.getItemAtPosition(position)?.equals("Instructor") == true)
                {
                    Toast.makeText(this@MainActivity,"Please select Instructor",Toast.LENGTH_SHORT).show()
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {

            }
        }

        //Volley
        requestQueue = Volley.newRequestQueue(this)
        arrayList = ArrayList()

        val calendar = Calendar.getInstance(TimeZone.getDefault())

        //Current Month
        val currentMonth: String = SimpleDateFormat("MMMM", Locale.getDefault()).format(Date())
        tvCurrentMonth.text = currentMonth

        //Get the greeting of day
        when (calendar[Calendar.HOUR_OF_DAY]) {
            in 6..11 -> {
                txvGreeting.text = getString(R.string.morning)
            }
            in 12..16 -> {
                txvGreeting.text = getString(R.string.afternoon)
            }
            in 17..20 -> {
                txvGreeting.text = getString(R.string.evening)
            }
            in 21..23 -> {
                txvGreeting.text = getString(R.string.night)
            }
        }
        arrayList.add(DataStu("BODYPUMP - Any Level","Sarah Baltzer","Fri in katie Humphrey Fitness Studio","5:30 am - 6:30 am(1 hour)"))
        arrayList.add(DataStu("BODYPUMP - Any Level","Sarah Baltzer","Fri in katie Humphrey Fitness Studio","5:30 am - 6:30 am(1 hour)"))
        arrayList.add(DataStu("BODYPUMP - Any Level","Sarah Baltzer","Fri in katie Humphrey Fitness Studio","5:30 am - 6:30 am(1 hour)"))
        arrayList.add(DataStu("BODYPUMP - Any Level","Sarah Baltzer","Fri in katie Humphrey Fitness Studio","5:30 am - 6:30 am(1 hour)"))
        arrayList.add(DataStu("BODYPUMP - Any Level","Sarah Baltzer","Fri in katie Humphrey Fitness Studio","5:30 am - 6:30 am(1 hour)"))
        arrayList.add(DataStu("BODYPUMP - Any Level","Sarah Baltzer","Fri in katie Humphrey Fitness Studio","5:30 am - 6:30 am(1 hour)"))

        adapter  = DataAdapter(arrayList, this)
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter
    }
}
